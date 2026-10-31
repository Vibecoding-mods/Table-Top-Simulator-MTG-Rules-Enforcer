# Hand test: hp-22 "Keywords 20" (40 cards)

Played 2026-10-28 on the live table (seat White, kit "Test 22: Keywords 20" spawned alone and loaded by
tmp/kit-22-direct.lua), against `mtg start 1` with `mtg aideck ai_handplay_rats`, `mtg mana 99`, Kenrith draws. Actions
through the table's own functions (tmp/act.js). Played to turn 8 with the library empty; the game was left at the
cleanup discard, still running, so Undo can take it back after the fixes.

## Worked
- Compleated (Vraska, Betrayal's Sting): cast, 6 loyalty; its 0 drew and proliferated; its -2 turned Relentless Rats
  into a Treasure artifact (the engine's types: Artifact — Treasure).
- Parley (Selvala): both top cards shown, {G} and 1 life for the nonland card, then each player drew.
- Offering (Blast-Furnace Hellkite): "pay Offering (Sacrifice an artifact)?", Matzalantli sacrificed, cost 5: {7}{R}{R}
  less Matzalantli's 3 and Eminence's 1.
- Eminence (The Ur-Dragon): Dragon spells cost {1} less (above); its attack trigger drew and put a land into play.
- Double strike for attackers (Hellkite): the Ur-Dragon dealt 20.
- Tempting offer (Tempt with Discovery): the AI accepted, so White searched twice.
- Recover (Garza's Assassin): paid half the life twice, back to the hand each time.
- Disappear (Rat King, Verminister): a Rat token at the end step after permanents left.
- Council's dilemma (Expropriate): both voted Money; White chose for each vote and gained control of Yargle.
- Tiered (Restoration Magic): the {1} tier cost {W}+{1}, 3 life.
- Fateful hour (Courageous Resolve) at 5 life: Vraska's 0 lost no life, and drawing from the empty library didn't lose.
- Pack tactics (Battle Cry Goblin): attacking with 7 power made a Goblin token tapped and attacking.

## Not tested here
- Paradox (Flaming Tyrannosaurus): needs a spell cast from somewhere other than a hand; none in this deck after the
  commander was out.
- Meld (Gisela needs Bruna, not in the deck), Grandeur (needs a second Page, Loose Leaf), Fathomless descent
  (Matzalantli's back face needs four permanent types in the graveyard).

## Findings
1. Vraska's {B/P} was paid from floating mana by itself: "Pay 2 life" was never offered (Compleated's loyalty depends on it).
2. Parley asked OK three times, twice for the AI's one Swamp: "look at these cards (your library)", "look at these
   cards (AI 1's library)", "Selvala, Explorer Returned - Revealing cards from (AI 1's library)". The game log said
   "White looked at a card (their library)" for a public reveal, hiding the Hellkite.
3. Target questions with no purpose: Vraska's -2 "choose a target", Courageous Resolve "choose up to 1 target".
4. The Treasure-ified Rats still read "Relentless Rats / Creature — Rat" on the table: the renderer refreshed a card's
   name line only when its first line changed.
5. The Ur-Dragon's trigger read "choose up to 1 card from your hand" (put a permanent card onto the battlefield).
6. Tempt with Discovery's search read "choose up to 1 card": three search sentences, so no purpose was said.
7. The game log said "White plays Forest", "AI 1 plays Swamp" for lands Tempt put onto the battlefield.
8. Recover's buttons: "Pay half your life, rounded up: return Garza's Assassin ... hand. Exile Garza's Assassin from
   the graveyard" and a bare "No".
9. The vote read "Expropriate: choose one" (Money | Time) with no word of what a vote does; the money vote's permanent
   read "choose a card".
10. The vote notice went to the game log as Forge's raw "AI 1 vote Money. Current Votes:{Money =[White, AI 1]}", and
    the chat's "Votes: Money : White, AI 1" had a stray space.
11. Tiered's modes had no names or extra costs and were sorted A-Z (Curaga, Cure, Cura).

## Fixes (bridge/bridge.js unless said)
1. Payment: a cost with a life option is asked even when the pool covers it ("Pay from mana pool" | "Pay 2 life").
2. revealCards: a reveal is titled "revealed (… library)" (Forge's "Look at these cards" for an ability that reveals
   and doesn't look at, and its "<card> - Revealing cards from"), logged as "saw: <card>: revealed from X's library:
   <cards>", and doesn't mark the next card into the hand as searched; the same cards shown again by the same card
   within 15 s are acknowledged without asking.
3. purposeOf: a loyalty cost is stripped, a granted ability in quotes left out, "up to one target" read:
   "which creature becomes a Treasure artifact and loses all other card types and abilities?",
   "which creature you control gains protection from each of your opponents until end of turn?".
4. tools/engine-renderer.lua: the card's name (with its type line) is set again whenever it differs.
5. purposeOf: "put which permanent card onto the battlefield?".
6. purposeOf: the same search said once; of a search for each player, the one asked is searching "your" library.
7. logEvents: a land arriving with no play is "puts X onto the battlefield"; a player's play comes from its record, an
   AI's from its hand.
8. Recover: Pay says the return only; No says "exile Garza's Assassin" (the "Otherwise," sentence).
9. "Expropriate: vote for time or money" with "Time: take an extra turn after this one" | "Money: choose a permanent
   owned by the voter and gain control of it", in Forge's order (Will of the council too); the permanent: "gain
   control of which permanent owned by the voter?".
10. The vote notice in plain words in the game log too, without the stray space.
11. "Restoration Magic: choose one tier (an extra cost)": "Cure (no extra cost): …", "Cura (+{1}): …",
    "Curaga (+{3}{W}): …", in the card's order.

Tests: 19 hp-22 scenarios in tests/golden/bridge-cases.js (460 in all); mutation run tmp/mut9.js 29/29 caught after two
more reveal cases closed two escapes; the renderer's line removed fails tests/test_table_golden.js (its recorded game
had a type change: "Faerie Seer / Creature — Faerie Wizard Ape"). All four gates pass.

TTS crashed once more (NVIDIA driver reset, nvlddmkm 153 at 08:46:29), two minutes after the script push reloaded the
table at ~84k loaded objects.

## Re-test (2026-10-28, real mouse clicks and drags after Undo)
Undo reached back only to turn 6 (the earliest point kept), so the fixes for things done before then (Vraska's {B/P},
Parley, Tempt, Recover, the vote, Tiered) were not seen again live; they rest on their scenarios.
Seen on the table: 3 (Vraska's -2 "which creature becomes a Treasure artifact and loses all other card types and
abilities?", by clicking Vraska, her -2 button and the creature), a land drag refused ("you already played a land this
turn", back to the hand) and the next turn's land drag played, the attack by clicking the Ur-Dragon then Attack (1),
and 5 after a fix (below). The game ended on turn 8: the Ur-Dragon's double strike took the AI from 20 to 0.

New findings:
12. Fix 5 didn't show live: the cards were in the hand, so the title was "choose up to 1 card from your hand" and the
    purpose rule only matched a title without "from your hand". Fixed (the rule allows it); scenario "hp-22: The
    Ur-Dragon's card from the hand, as Forge asks it live" (hand cards, Forge's description) failed before, passes after;
    no other scenario changed. Seen live: "The Ur-Dragon: put which permanent card onto the battlefield?".
13. Engine (Forge's Undo): after rewinding to turn 6, Yargle (the AI's commander, stolen by Expropriate before then)
    was both on White's battlefield and back in the AI's command zone. Vraska's -2 didn't offer it; the AI then cast it
    from the command zone while White could still attack with it (both under engine-card-140). The table can draw one.
    Deferred engine item, with the other Forge items.
14. After a TTS relaunch the loaded table showed READY instead of the running game: the bridge got the table's "hello"
    (over the web channel) but didn't redraw; a second hello from the table did. To look into.
15. The ability panel cut Vraska's -2 button mid-word ("... with "{T}, Sacrifice t").
16. The stack card's zoom text ends in Forge's note "[Number Attackers: [The Ur-Dragon]]" (as the Room/Card notes, hp-08
    #3 #7).
17. The game log after Undo: the rewind's life change reads as damage ("AI 1: 40 -> 30 life (-10)" twice), and the
    turn after it is "White's turn 5" (White's 4th turn).
18. The game log: a Treasure (the Rats) sacrificed for mana "dies"; and the AI's land played from its hand read "AI 1
    puts Swamp onto the battlefield" (fix 7's hand check after a bridge restart, to check).

17 corrected: the life lines after Undo were real. The point was "turn 6, White's attacks" and Forge replayed that
combat (the Ur-Dragon's double strike, 40 -> 30 -> 20). The turn number was wrong from the game's start: Forge's turn 0
(the mulligans) has White marked active and counted as White's turn.

Fixes (re-test): 12 (above); 14 the table asks again ("hello" with again, no second greeting) every 10 s, three times,
while nothing has been drawn; 15 the ability panel cuts at a word with "…" and shows the whole text on hover; 16 any
"[Name: ...]" note is left out, one bracket deep; 17 turn 0 is nobody's turn; 18 "dies" goes by what the card was on
the battlefield, and an AI's land play by Forge's landsPlayedThisTurn (0 again on a new turn; the hand only without
it). Tests: 4 more scenarios (465), the earlier land case given the AI's land-play count as Forge sends it; mutation
run tmp/mut10.js 12/13 caught after three more inputs (turn 3, a count of 0, a new turn); the one left, lowercase note
names stripped too, changes nothing on real text (card text has no "[lowercase: ...]"). Table script pushed after the
game ended; the user's save restored (a8f1348fbca34a16).

Not ours: the user's own Thantis card's description shows "Legendary Creature â Spider" (a text encoding slip in the
save's own card).
