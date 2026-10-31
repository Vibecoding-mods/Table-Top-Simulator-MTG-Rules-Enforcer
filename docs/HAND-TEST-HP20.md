# Hand test: hp-20 "Keywords 18" (40 cards)

Played 2026-10-29, seat White (kit "Test 20: Keywords 18" by tmp/kit-20-direct.lua), against `mtg start 1` with
`mtg aideck ai_handplay_rats`, `mtg mana 99`, Kenrith draws; actions through the table's functions (tmp/act.js).
Same TTS session as hp-18 and hp-19 (~82,900 loaded objects, no crash).

Covers: Surge, Spectacle, Conspire, Afflict, Training, Swampcycling, Islandcycling, Forestcycling, Cloak, Will of the
council, Opus, Haunt, Companion, Read Ahead, Web-slinging.

## Worked
- Read ahead (The Cruelty of Gix): started on chapter III.
- Training (Torens): each creature cast made a Human Soldier token.
- Spectacle (Light Up the Stage): after Blind Hunter's drain, "how do you play it?" ... (Spectacle); two cards exiled
  to play.
- Forestcycling (Generous Ent): "how do you play it?" Forestcycling {1} | Cast; "search your library for which Forest
  card?"; "White discards Generous Ent", "puts a card from their library into their hand".
- Conspire (Rally the Galadhrim): "tap two untapped creatures you control that share a color with it?" (the sweep's
  rule); declined; a Soldier token copied.
- Opus (Molten-Core Maestro): an instant cast gave it a +1/+1 counter.

## Findings and fixes (bridge/bridge.js)
1. Read ahead asked "The Cruelty of Gix: How many counters?". Fixed: "read ahead: start on which chapter?" with "The
   chapters before it don't happen." under it.
Not tested: Surge, Afflict (the AI had no blockers), Swampcycling/Islandcycling (Forestcycling the same rule), Cloak,
Will of the council, Haunt (Blind Hunter didn't die), Companion, Web-slinging (Spider-Sense needs a spell to counter).
Tests: 624 bridge scenarios. Mutation pass tmp/mut30.js: 2/3; the escape (a Read ahead card's other number question)
is now an input: 3/3.

## Gap fill (2026-10-30)
Kit "Gap 20" (tmp/handplay/gap-20.json) against ai_gap_creatures. Companion skipped (the user's decision; see
docs/m5-plan.md: Forge takes a companion only from the sideboard, which the bridge never sends).

Played in the first game:
- Swampcycling / Islandcycling: Troll of Khazad-dûm and Monstrosity of the Lake cycled ("White cycles ...").
- Surge: after Kenrith was cast, "Cast Fall of the Titans — surge" for {X}{R}, X=3 at the AI.
- Cloak: Unexplained Absence exiled the AI's Storm Crow; the AI cloaked its top card (a face-down 2/2 with ward {2},
  Garruk's Companion).
- Will of the council: Council's Judgment, both players voted Burning-Tree Emissary: exiled.
- Haunt (first try): Blind Hunter murdered, its haunt trigger targeted the cloaked creature; Go for the Throat (queued
  by the test script while the ward question was open) destroyed that creature before the haunt trigger resolved, so it
  had no target and Blind Hunter stayed in the graveyard: correct rules, a script mistake.
- Afflict (first try): Neheb attacked; the AI didn't block a 4/6.

Findings and fixes:
1. The face-down creature's ward question named it: "Garruk's Companion has ward: pay {2}" and "Pay {2} for Garruk's
   Companion" (bridge/bridge.js). Hidden information. Fixed: a face-down source card of someone else's (by Forge's flag
   or the board's) asks as "A face-down creature"; the stack line reads "a face-down permanent's ward triggers".
2. The face-down card leaving read in the log "White saw: Face-down card leaves the self-hosted-node-…-bot's
   Battlefield:" (the engine account name). Fixed: every game-log line goes through the table names (gameLogLine), and
   the title reads "A face-down card left AI 1's battlefield".
3. The cloak read "AI 1 puts a card onto the battlefield face down". Fixed: "AI 1 cloaks a card: a face-down 2/2 with
   ward {2}" when what just resolved cloaks.
4. Blind Hunter's haunt target read "which player loses 2 life and you gain 2 life?" over creatures. Fixed: "Blind
   Hunter: haunt which creature?" when it is dying and the candidates are creatures (its later trigger over players
   keeps its sentence).
5. Council's Judgment's vote read "choose one" over "Burning-Tree Emissary (106)". Fixed: "vote for which nonland
   permanent you don't control?" without Forge's object numbers (word votes such as Expropriate's keep their own).
6. Engine crash: with Spider-Sense in hand during an attack, the harness's playable-list check of stack targets hit a
   NullPointerException in Forge's SpellAbility.isValid (root.getCardState() unguarded) and the relay aborted the game.
   Fixed in manabrew/forge-harness ActionSpace.getStackTargetCandidates: a stack candidate whose target check throws is
   skipped. Needs the rebuilt mtg-forge-node image (rollback tag mtg-forge-node:npe-prev).

Second game (rebuilt image 8b8d6ff33d14, fix 6 in):
- Web-slinging: Kenrith attacked (tapped); in combat (Combat stop on) Murder at Blind Hunter, then "Cast Spider-Sense —
  web slinging": Kenrith returned as its cost, Murder countered. Spider-Sense in hand no longer crashed the engine.
- Afflict: Kenrith's counters made Sisay a 6/6; Neheb attacked, Sisay blocked: "Neheb, the Eternal's afflict triggers",
  the AI lost 3.
- Haunt: Go for the Throat on Blind Hunter: "Blind Hunter: haunt which creature?" (live), Sisay picked; Fall of the
  Titans (surge, X=7) killed Sisay: the haunt trigger made the AI lose 2 and White gain 2.

More findings and fixes (bridge/bridge.js):
7. Kenrith returned by Spider-Sense's web-slinging cost asked "Blind Hunter: put it into the command zone instead?" (the
   first card target on the stack, Murder's). Fixed: the seat's own commanders are kept from its deck; the question
   names one of them targeted on the stack, else the only one.
8. The haunt showed nowhere: "Blind Hunter is exiled from White's graveyard". Fixed: the creature picked is noted:
   "Blind Hunter is exiled haunting Sisay, Weatherlight Captain" and "Haunted by Blind Hunter" on Sisay until either
   leaves.
Tests: 809 bridge scenarios. Mutation pass tmp/mut52.js: 20 mutations, 2 escaped (10%), both closed with inputs (a haunt
card's own enter trigger over creatures while it is on the battlefield; a face-down creature's ward on the stack) and
re-run caught (tmp/mut52b.js 2/2).
