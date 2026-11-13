# Readability audit, 2026-11-12: plays right, hard to read

Trigger: Prepared plays correctly but shows no marker, and its log says only "Reanimate is exiled". The fix is in progress separately. Four read-only Sonnet audits then looked for the same kind of gap everywhere. Each gap was checked against the code with file:line evidence. The details, with evidence and an "already fine" list, are in:

- [A: states on permanents](readability-audit/A-permanent-states.md)
- [B: linked and playable cards in exile, graveyard and the command zone](readability-audit/B-linked-zones.md)
- [C: game log](readability-audit/C-game-log.md)
- [D: player and game state](readability-audit/D-player-game-state.md)

None of these has been checked live yet: the audits only read code, docs and old logs.

## Root causes (fixing these closes many rows at once)

1. **The engine drops Forge's "Effect" cards from the command zone** (`InteractiveSnapshotExtractor.java:197`, `!card.isImmutable()`). Emblems, skipped turns and phases, Fog effects and "this turn" rules all live on those cards, so the table never sees them. (D1, D2, B6)
2. **The engine already sends the cause of every move made during resolution** (`EngineEventLog.java` markCause, 134-165; kept by `engineFacts`, `bridge.js:2491`). The log uses it only for costs, sacrifice, explore and draw. Removal, bounce, reanimation and discard lines ignore it. (C1)
3. **The card contract (`toCard`, extractor 755-898) lacks several Forge flags:** monstrous, saddled, harnessed, rooms unlocked, case solved, paired, exerted-until-next-untap, attachment to a player, and delayed "at end step" riders. (A3, A5, A7, B2)
4. **The bridge already knows some states but never shows them:** detained, regeneration shields, the ring-bearer in the log, and opponents' mana pools. (A8, C7, D7)

## Ranked list

Harm = how common in Commander × how confusing.

### No engine change (bridge and table only)

| # | Gap | Example | Size | Source |
|---|---|---|---|---|
| 1 | **You can't see your own face-down creatures**: the table hides them from their controller too, which breaks a rule | morph, manifest, disguise, cloak | M | A1 |
| 2 | Removal, bounce, reanimation and forced discard log lines name no cause | "Batterskull is destroyed" (by Krosan Grip?) | M | C1 |
| 3 | Impulse draw: no card names who granted it or when it ends, and it drops back to exile silently | Jeska's Will, Light Up the Stage, Prosper | S | B1 |
| 4 | Triggers and activations never say what they do | "Hero of Bladehold's ability triggers" | M | C2 |
| 5 | "Doesn't untap during your next untap step" shows nothing | Frost Breath, Sleep | S | A2 |
| 6 | "Exiled with X" never names X; the O-Ring kind gets no "comes back" hover | Banishing Light, Oblivion Ring, Fiend Hunter | S | B3 |
| 7 | Life changes other than damage are bare | "White: 40 -> 42 life (+2)" | M | C3 |
| 8 | Partner commander damage is summed in the display (15 + 10 shows 25 against 21; the loss check is right). **Fixed 2026-11-12, not yet seen live:** the tracker shows the most from one commander, its tooltip each commander's damage (bridge `cmdDamageRow`, `cmdTip`; table `engineCmdDamageTip`); a commander in a library or hand is counted (owner from `commanderCasts`); the counter turned in a fix sets the commander it shows | partner pairs | S | D4 |
| 9 | Cards playable from the graveyard leave the graveyard pile with no origin label; only flashback has a note | escape, disturb, unearth, jump-start | S | B4 |
| 10 | A third card in the command zone lands on the first commander. **Fixed 2026-11-12, not yet seen live:** command cards past the two tax labels get a row of their own toward the table's centre, under the labels and the dungeon's spot, clear of the tax numbers; a sixth and on fan over the fifth (`engineExtraCommandSpot`). Emblems themselves still don't reach the table (E1) | emblems, effect cards | S | B6 |
| 11 | An extra combat or main phase looks like the first one. **Fixed 2026-11-12, not yet seen live:** the bridge counts the phases of each turn from the steps (`phaseNumber`, reset by a rewind) and sends `phaseNo`; the phase bar reads "COMBAT (2)" / "MAIN (3)" and the step banner the same | Aggravated Assault, Relentless Assault | S | D6 |
| 12 | Detained and regeneration shields are tracked but not shown | Lavinia, Ivy Lane Denizen-style regen | S | A8 |
| 13 | A copy cast from exile is logged as a token's ability | Arcane Bombardment | S-M | C5 |
| 14 | Monarch, initiative and control changes give no cause or previous holder; initiative prints after its venture | – | S | C6 |
| 15 | The Ring's log line never names the Ring-bearer; the label doesn't spell out the level's effect | The One Ring tempt | S | C7, D8 |
| 16 | Opponents' floating mana is never shown. **Fixed 2026-11-12, not yet seen live:** the bridge sends every player's non-empty pool; your status line adds "Floating: AI 1 RR · Red G" under your own pool | – | S | D7 |
| 17 | Mutate: the cards under the top one are never listed | Illuna, mutate decks | M | A4 |
| 18 | Suspend: time counters only show in the pile's hover; no countdown in the log | Rift Bolt, Ancestral Vision | M | B5 |
| 19 | Foretold cards: opponents see no count | Doomskar, Saw It Coming | M | B7 |
| 20 | Skipped turns leave no trace (stopgap: log when a seat is passed over). **Stopgap done 2026-11-12, not yet seen live:** "AI 1's turn is skipped" above the new turn's header when the turn order passes over a player still in the game (`skippedTurns`: extra turns follow Forge's stack, so they don't count; nothing without Forge's isExtraTurn flag or when boards were missed). Why, and a warning beforehand, still need E1 | Eater of Days | S | D2 |
| 21 | Vote and reveal notices may print once per seat that acknowledges them (unconfirmed live) | Council's Judgment | S | C8 |
| 22 | Smaller items: no reason on "Game over"; no line for a countered ability; no tag on AI free casts; commander damage not flagged in the log | – | S each | C9-13 |

### Needs an engine change (harness field plus an image rebuild; batch them into one rebuild)

| # | Gap | Example | Size | Source |
|---|---|---|---|---|
| E1 | Emblems and "this turn" rule effects are invisible (root cause 1) | Teferi's Protection, Moment's Peace, Gideon's emblem | L | D1 |
| E2 | Nothing warns that a permanent leaves, or an exiled card returns, at end of turn | Sneak Attack, Kiki-Jiki, Flickerwisp, dash, unearth | M-L | A5, B2, D3 |
| E3 | The exert marker vanishes at cleanup while the creature is still frozen (one line: send `isExertedBy`) | Combat Celebrant | S | A3 |
| E4 | Monstrous, saddled, harnessed, rooms, case solved, soulbond partner, battle protector | Polukranos, case cards | S each | A7, A |
| E5 | Floating "can't block / must attack" effects | Falter, Lure | M | A6 |
| E6 | Spells cast this turn, the storm count, and life gained or lost this turn | storm, Emeritus "third spell" | M | D5 |
| E7 | Divided damage has no damage line | Fury, Electrolyze, Arc Trail | M | C4 |
| E8 | The cost of a card in the playable row (cost badge phase 2) | airbend, free casts | M | B8 |
| E9 | Curses attached to a player look unattached | curse decks | S | A |

## Suggested order

1. **Batch 1 (no engine change, about 2-3 days with agents):** rows 1-12. The face-down peek comes first because it breaks a rule.
2. **Batch 2:** rows 13-22.
3. **One engine rebuild for E1-E9** (about 3-4 days): one harness change, then one image build and the gates.
