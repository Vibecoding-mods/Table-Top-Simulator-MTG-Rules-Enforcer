# Readability audit, part D: player-level and game-level state

Audited 2026-11-12, read-only. Question: which player-/game-level mechanics does the engine run correctly but the table
does not show (or shows misleadingly), as Prepared was? Prepared itself is another agent's. Line numbers are in the
files as they stood today.

Files: harness `manabrew/forge-harness/src/main/java/forge/harness/host/InteractiveSnapshotExtractor.java` (H),
bridge `bridge/bridge.js` (B), table `tools/engine-renderer.lua` (L).

Root cause behind the top two rows: H:195-199 builds the command zone with `if (!card.isImmutable())`, and
`Card.isImmutable()` is `gamePieceType == EFFECT` (`manabrew/forge/forge-game/.../Card.java:1073`). Every Forge "Effect"
card (emblems, skip-turn, skip-phase, Fog, damage-prevention, "until end of turn" rules, Teferi's Protection style
effects, `createEffect` users: AddTurn, DamagePrevent, Effect, Fog, SkipPhase, SkipTurn, Regenerate, Play, ChangeZone,
Heist, Airbend, AlterAttribute, Amass) is dropped before the bridge ever sees it. The bridge has dedicated fields for
only the ones it knows (monarchId, initiativeHolderId, dayTime, extraTurnCount, damagePrevention, dungeonState). No
other Effect reaches B or L (grep "emblem" in B: only a comment at B:4838; in L: only a comment at L:90).

## Gaps, sorted by harm (how common x how confusing)

| # | Mechanic | Example card | Engine does | Table shows today (file:line) | Missing | Suggested fix | Size | Engine change? |
|---|---|---|---|---|---|---|---|---|
| 1 | Emblems and "this turn" rule effects (Effect cards) | Gideon, Ally of Zendikar (emblem); Elspeth, Knight-Errant (-8 emblem); Ajani Steadfast (-7 emblem); Moment's Peace / Fog (prevent all combat damage); Teferi's Protection | Applies the effect for the rest of the game / turn | Nothing. Dropped at H:197 (`isImmutable`); B sendTable 4304-4333 sends no effect list; marks list B:4656-4710 has no row; L marks boxes L:1153 draw only `allMarks`. No log line either (no emblem/effect wording in B) | A marker per player: "EMBLEM: creatures +1/+1", "FOG THIS TURN", "LIFE CAN'T CHANGE"; a log line when one is created | Harness: send per player `effects: [{name, text, untilEndOfTurn}]` from command-zone cards where `isImmutable()` and not already covered (monarch/ring/initiative/dungeon/skip). Bridge: new PLAYER_MARKS row (list value, like `keywords`), label = short name, full text in a log line when added. Table needs no change (marks boxes take any label, `+n MORE` after 10) | L (harness + node DTO + image rebuild) then S in B | yes |
| 2 | Skipped turn / skipped phase | Eater of Days (skip next two turns), Stasis-style skips, "skip your next combat" cards, Time Stop | Skips it (SkipTurnEffect / SkipPhaseEffect hold the skip in a hidden Effect card, `SkipTurnEffect.java:35-55`) | Nothing. The turn header just passes to the next player. No "skips" wording in B (grep) | "WHITE'S NEXT TURN IS SKIPPED" marker and a log line when it happens | Part of row 1's `effects`. Cheaper stopgap with no engine change: B `trackTurns` already knows the turn order, so when the active player jumps past a seat say "<name>'s turn is skipped" in the log (cannot say why or warn beforehand) | S (stopgap) / part of row 1 | stopgap no, full yes |
| 3 | Delayed triggers waiting | Sneak Attack / Kiki-Jiki ("sacrifice at the beginning of the next end step"), Flickerwisp / Brago ("return at the next end step"), Pact of Negation (upkeep cost or lose), Ephemerate rebound | Triggers at the right step | Nothing on the card or the player. The card sits in exile / on the battlefield looking ordinary. The bridge reads delayed-trigger words only to word log lines after they resolve (B:2214-2219, B:5129) | A badge on the card ("Returns at end step", "Sacrificed at end step") and a player mark for Pact ("PACT UPKEEP") | Engine: send `delayedTriggers: [{hostCardId, text, turn/step}]` from the TriggerHandler. Stopgap without engine: B reads the resolved ability's text (as goad does, B:3304-3309 and the badge at B:1879-1881) and adds a card badge until the named step passes. Fragile (text reading) | M stopgap / L exact | stopgap no, exact yes |
| 4 | Commander damage with partners / several commanders | Thrasios + Tymna, Kydele + Thrasios, any partner pair | Counts per commander; loses at 21 from ONE commander (loss reasons use the max, B:4491) | B:4310-4313 sums every commander of one owner into one number per colour; L:1050 sets that single tracker. 15 from one partner + 10 from the other displays 25 against a 21 limit while the player is alive | A number per commander, or at least the max | Cheapest: send the max per colour instead of the sum, and put the sum in the tracker tooltip. Exact: key `cmdDamage` by commander and add a second tracker (the original table has one per colour, `CMD_DAMAGE` L:9, so this needs the extra counter object). Same loop drops damage from a commander the board cannot place (`byId[cid]` is built from visible zones only, B:4311; a commander in a library is lost) | S (max) / M (two trackers) | no |
| 5 | Spells cast this turn / storm count / life gained this turn | Grapeshot, Emeritus of Ideation style "third spell", Monastery Mentor, Sorin Vengeful Bloodlord, Bloodthirst | Tracks them (`Player.getSpellsCastThisTurn()` Player.java:2321, `getLifeGainedThisTurn` 2349, `getLifeLostThisTurn` 2360) | The harness sends none (H:319-356 toPlayer lists every field sent; these are absent; `cardsDrawnThisTurn` is sent at H:334 but nothing reads it either). Players count casts from the log | "SPELLS 3" style turn counter under the active player's life | Harness: add `spellsCastThisTurn`, `lifeGainedThisTurn`, `lifeLostThisTurn`, `cardsDrawnThisTurn` (already there). Bridge: PLAYER_MARKS row shown only for the active player and only when >= 2 (avoid permanent clutter) | M (harness + DTO + bridge row) | yes |
| 6 | Extra combat / extra main phase | Aggravated Assault, Relentless Assault, Hellkite Charger | Runs the extra phase | The phase bar (L:3535-3541) just lights COMBAT / MAIN again; nothing says it is a second one. B knows the step went backwards in the same turn (B:9954 comment) but does not tell the table | "2nd COMBAT" on the phase bar | B: when the step order regresses within one turn, add a `phaseNo` to the table message; L: append " (2)" to the lit phase name | S | no |
| 7 | Opponents' floating mana / persisting mana | Omnath, Locus of Mana; Upwelling; Kruphix | Keeps the pool | Own pool only, as text in the status line (L:3965-3978 `poolText`; B:4316 sends `pool` only for seats: `own ?` else null). Opponents' and AI's pool never shown | Pool for the active player visible to all | Send the pool for every player (it is public information in paper); mark box "POOL GG B" for a non-empty pool outside the owner's own prompt | S | no (H sends `manaPool` for all, H:347) |
| 8 | The Ring: level effects and ring-bearer | The One Ring, Call of the Ring, Sauron's Ranks | Applies the level's abilities | Box "RING TEMPTED n" (B:4682), status piece card (docs/status-objects-spec.md), card badge "Ring-bearer" (B:1886). The abilities the level grants (legendary, can't be blocked by greater power, loot on attack...) are not spelled out except on the Ring piece's static card face | One line in the box: "RING 2: bearer can't be blocked by greater power" | Label by level: add a short phrase per level 1-4 to the label in the `ring` row. Needs no engine | S | no |
| 9 | Team number (two-headed giant / team games) | any team game | Sends `teamNumber` (H:350-353) | Not read anywhere (no `teamNumber` in B or L) | Team marker / shared life | Only matters if team formats are ever offered. Skip unless planned | S | no |

Unverified (could not confirm from code; treat as questions, not gaps):

- Whether Forge's `CounterEnumType` has other player-countable counters than the five H sends (H:411-419: poison,
  energy, experience, rad, ticket). Any other would be dropped silently.
- Whether the engine's event log emits a line when an emblem is created (EngineEventLog.java filters
  `EFFECT_REPLACED` only, line 86). The bridge has no emblem wording, so likely nothing.
- "Pact upkeep cost" harm is partly mitigated: the engine forces the payment prompt at upkeep, so the risk is
  forgetting before then, not an unexplained loss.

## Already fine (code-verified)

All of these are in PLAYER_MARKS (B:4656-4710) -> `allMarks` -> boxes under the life counter (L:1105-1186), or have
their own display:

- Poison, energy, experience, rad, tickets (B:4658-4666, 4673-4676). The log says each change (poison/energy rows).
- Monarch and initiative: boxes, status pieces (crown, Undercity), log lines when taken (B:4663-4666).
- Dungeons: completed count box (B:4678-4685), the current dungeon as its own command-zone card with room badge
  (`dungeonRow`, B:4333-4338; L:509), room log lines.
- City's blessing, enduring story (B:4668-4671).
- The Ring temptation count with log line; ring-bearer badge on the card (B:4686-4690, B:1886).
- Speed (Start your engines) with max-speed wording (B:4691-4694).
- Day / night: top bar DAY / NIGHT (L:3547), log line (B:3942), status piece.
- Extra turns: "EXTRA TURN" label plus the count beside the life counter (B:4706-4709, docs/extra-turn-counter-spec.md).
- Another player in control (Mindslaver, Opposition Agent): "CONTROLLED BY" / "TURN RUN BY" box, log lines (B:4695-4703).
- Damage prevention shields on the player: "PREVENT n" (B:4710). Card-level source shields are tracked for the log (B:948-966).
- Hand size changes: "MAX HAND n" / "NO MAX HAND SIZE" (B:4711-4712).
- Player keywords incl. "You can't lose the game." and hexproof (B:`playerKeywordLabels` 4731-4736).
- Commander damage (single commander) and commander tax: original trackers (B:4310-4322, L:1050-1051); loss reason by max
  (B:4491); commander cost badge includes tax (B:1938-1947).
- Mana pool for the seat's own player (L:3965-3978).
- Lands played this turn: refusal text when the land drop is used (B:8596) and the playable row follows the engine's legal actions.
- Goad: card badge "Goaded by X" until the goader's next turn plus log (B:1879-1881, 3304-3309).
- Suspend: time counters on the exiled card, "is exiled suspended with N time counters" log (B:2567, 3633).
- Council votes / voting: tally lines in the log (B:7983-7985), vote prompts worded (B:7618, 7725).
- Planechase: plane / phenomenon name in the top bar (L:3550-3552), plane card at the centre, planeswalk / encounter
  log lines (B:3936-3938), planar die as an action (B:425-439).
- Rewind / vote state, manual fix state (sent in the board update).
- Mulligan, extra draws, library counts: tracked by existing UI (not in scope but seen).

## Top 8 (for the report)

1. Effect cards hidden: emblems, Fog, Teferi's Protection style rules (row 1). Engine change.
2. Skipped turns/phases invisible (row 2). Stopgap log line without engine.
3. Delayed triggers pending (sacrifice/return at end step, Pact) (row 3). Stopgap by text reading.
4. Partner commander damage summed per colour, looks lethal at 25 (row 4). S, bridge only.
5. Spells cast this turn / storm / life gained not sent (row 5). Engine change.
6. Extra combat indistinguishable on the phase bar (row 6). S, bridge + table.
7. Opponents' floating mana never shown (row 7). S, bridge only.
8. Ring level abilities not spelled out in the box (row 8). S, bridge only.
