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
| 8 | Partner commander damage is summed in the display (15 + 10 shows 25 against 21; the loss check is right) | partner pairs | S | D4 |
| 9 | Cards playable from the graveyard leave the graveyard pile with no origin label; only flashback has a note | escape, disturb, unearth, jump-start | S | B4 |
| 10 | A third card in the command zone lands on the first commander | emblems, effect cards | S | B6 |
| 11 | An extra combat or main phase looks like the first one | Aggravated Assault, Relentless Assault | S | D6 |
| 12 | Detained and regeneration shields are tracked but not shown | Lavinia, Ivy Lane Denizen-style regen | S | A8 |
| 13 | A copy cast from exile is logged as a token's ability | Arcane Bombardment | S-M | C5 |
| 14 | Monarch, initiative and control changes give no cause or previous holder; initiative prints after its venture | – | S | C6 |
| 15 | The Ring's log line never names the Ring-bearer; the label doesn't spell out the level's effect | The One Ring tempt | S | C7, D8 |
| 16 | Opponents' floating mana is never shown | – | S | D7 |
| 17 | Mutate: the cards under the top one are never listed | Illuna, mutate decks | M | A4 |
| 18 | Suspend: time counters only show in the pile's hover; no countdown in the log | Rift Bolt, Ancestral Vision | M | B5 |
| 19 | Foretold cards: opponents see no count | Doomskar, Saw It Coming | M | B7 |
| 20 | Skipped turns leave no trace (stopgap: log when a seat is passed over) | Eater of Days | S | D2 |
| 21 | Vote and reveal notices may print once per seat that acknowledges them (unconfirmed live) | Council's Judgment | S | C8 |
| 22 | Smaller items: no reason on "Game over"; no line for a countered ability; no tag on AI free casts; commander damage not flagged in the log | – | S each | C9-13 |

### Needs an engine change (harness field plus an image rebuild; batch them into one rebuild)

Status (2026-11-12): the engine fields come from image `engine1112` (`tmp/mb-wt-merge`, branch `engine-1112`); the
bridge and table side of E1-E6 and E9 is built (bridge `cardStateWords`, `delayedOf`, `effectMarks`, `spellsMark`,
`playerMarks`' `markTips`/`lifeTip`; table `enginePlayerCounters` per-box hover text and two-line marks,
`engineLifeTip`, curses laid by `attP`), checked in `tests/test_bridge_claims.js` and `tests/test_table_claims.js`
("engine1112 ..."), **not deployed and not seen live**. With an older engine none of it shows (the fields are absent).

| # | Gap | Example | Size | Source | Status |
|---|---|---|---|---|---|
| E1 | Emblems and "this turn" rule effects are invisible (root cause 1) | Teferi's Protection, Moment's Peace, Gideon's emblem | L | D1 | Built: a marks box per effect under the life counter ("FOG THIS TURN", "EMBLEM: GIDEON", "TEFERI'S PROTECTION / UNTIL YOUR NEXT TURN", "SKIPS NEXT 2 TURNS"), the whole text in its hover; past three, "+N MORE EFFECTS" |
| E2 | Nothing warns that a permanent leaves, or an exiled card returns, at end of turn | Sneak Attack, Kiki-Jiki, Flickerwisp, dash, unearth | M-L | A5, B2, D3 | Built: the affected card's status box (pile note in exile or a graveyard) says "Sacrificed / Exiled / Returns at end step"; the trigger's own card "At end step: sacrifice Hill Giant"; a pact's cost is a mark on its caster ("NEXT UPKEEP: PAY {3}{U}{U}") |
| E3 | The exert marker vanishes at cleanup while the creature is still frozen (one line: send `isExertedBy`) | Combat Celebrant | S | A3 | Built: "Exerted (won't untap)" until its controller's untap step; "Doesn't untap next untap step" for `skipsNextUntap` |
| E4 | Monstrous, saddled, harnessed, rooms, case solved, soulbond partner, battle protector | Polukranos, case cards | S each | A7, A | Built: "Monstrous", "Saddled (by X)", "Harnessed", "Solved", "Unlocked: <door>" / "Both doors unlocked", "Paired with X", "Protected by <player>" |
| E5 | Floating "can't block / must attack" effects | Falter, Lure | M | A6 | Built: "Can't attack", "Can't block", "Can't attack or block", "Must attack" (no "Can't attack" for a creature with defender) |
| E6 | Spells cast this turn, the storm count, and life gained or lost this turn | storm, Emeritus "third spell" | M | D5 | Built: "SPELLS THIS TURN: N (STORM M)" on the active player; life gained and lost this turn in the life counter's hover |
| E7 | Divided damage has no damage line | Fury, Electrolyze, Arc Trail | M | C4 | Engine sends damage events (engine1112); the log line is separate work. The bridge reads the ring with them in it unchanged (checked) |
| E8 | The cost of a card in the playable row (cost badge phase 2) | airbend, free casts | M | B8 | Not in this batch |
| E9 | Curses attached to a player look unattached | curse decks | S | A | Built: a curse on another player lies on that player's mat with their other permanents, its box saying "Attached to <player>"; its controller still moves it |

## Suggested order

1. **Batch 1 (no engine change, about 2-3 days with agents):** rows 1-12. The face-down peek comes first because it breaks a rule.
2. **Batch 2:** rows 13-22.
3. **One engine rebuild for E1-E9** (about 3-4 days): one harness change, then one image build and the gates.
