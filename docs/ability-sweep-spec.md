# Ability sweep: spec, always-on invariants, results (prep, 2026-11-07)

The keyword sweep (25 plans) and the mechanic runs (28 decks) found no rules bugs: every bug was a **table** bug, in
log wording, button labels or prompt options. The Kykar play-test (docs/HAND-TEST-KYKAR.md) found more of them, and
none came from a keyword. They came from ordinary card shapes: a mana ability with no {T}, a pain land, an equip
whose target dies at once, a "choose a source" prompt. This sweep goes by Forge **ability type** (ApiType) and
**cost / prompt shape** instead.

**This is preparation only.** Nothing was run on the real table, in TTS or against the live stack. The live engine
text below comes from my own relay and node containers (the same images as the live stack). They were removed
afterwards.

## Files

| file | what it is |
|---|---|
| `docs/ability-type-census.md` | ApiType and shape counts over Commander-legal scripts, ranked by card count, with played / checked columns (generated) |
| `tmp/ability-census.js`, `tmp/ability-census.json` | the census generator, plus its raw rows and full card lists (each played/checked credit can be audited there) |
| `tmp/ability-probe.js`, `tmp/ability-probe.sh` | the live-text probe: 34 steps on own containers, replayed through `bridge.js` offline (tests/bridge-harness.js) |
| `tmp/ability-probe-report.txt` | for every probe step: the engine prompt (raw), the table's question, and the table's log lines |
| `tmp/ability-sweep-plan.json` | the plan list: 25 plans, 60 steps, 119 expected lines (kw-sweep-plan.json's keys and setup keys) |
| `tmp/ability-run.js` | a copy of `tmp/kw-run.js` that runs one plan (kw-run.js itself is unchanged) |
| `tmp/log-invariants.js` | the always-on checks over saved reports; also called by `ability-run.js` at the end of every run |

## Where the expected text comes from

Each expected line starts with a tag:

- **`[live]`** — text seen from the real engine plus the current `bridge/bridge.js`. Sources: the probe
  (`tmp/ability-probe-report.txt`), the Kykar notes, the kw/mech reports, and `tests/live_events_check.js`.
- **`[proposed ...]`** — the wording a fix should produce. This is a target, not a guess at today's text: align it with
  whatever wording the fix chooses. The tag names the Kykar bug it comes from.
- **`[guess]`** — 2 lines whose live text nobody has seen yet:
  - Rampant Growth's land line;
  - Azorius Signet's payment label.

  Pin them after the first run.

**Grammar (only in `ability-run.js`).**
- **Notes in parentheses.** Parentheses outside quotes are notes and are never matched, so a note can quote today's
  wrong text.
- **Matching.** Every quoted fragment outside the notes must appear (a positive check). If the line's own words outside
  the notes say "not", "no" or "never", none of them may appear (a negative check).
- **kw-run.js.** It would also try to match the quotes inside the notes, so run this plan with `ability-run.js`.

**What a run shows before any fix.**
- `[live]` positive lines: OK.
- `[live]` negative lines on known-bad text: MISS. That is the bug, still there.
- `[proposed]` lines: MISS.

After a fix, all three should be OK.

**Caveats on the probe text.**
- **Seat names.** The offline replay has no seat list, so it shows engine usernames ("abl-probe-0-...") or "Red"
  where the table shows "White" or "AI 1". The plans use the table's names.
- **Answer-time lines.** Lines the bridge writes only when the table answers a question are not reproduced by the
  replay: scry's "White scries 1: ..." and "White chooses X (card)". For these the plans use the wording the kw sweep
  saw live.
- **Log windows.** The probe's per-step log windows lag by about one step. For example, painland's damage line is
  printed under the painland step, and Raise the Alarm's payment under the Kykar step.
- **Painland step.** It hit "stuck in resolve" in the probe. It still paid (Adarkar Wastes + Battlefield Forge), and
  its label and life line were captured.

## How to run (later, not now)

**Preconditions.** One plan per TTS launch (memory: the first game per launch adds about 11k objects). No game may be
running. The table must be in its usual debug state, as for `kw-run.js`.

```
node tmp/ability-run.js tmp/ability-sweep-plan.json ab-01      # report: tmp/ability-runs/ab-01.txt
```

**What the runner does.**
1. Writes `scenarios/<id>.json` and `tmp/wt-head/scenarios/<id>.json`.
2. Resets the room, starts White against one AI, and applies the setup.
3. Plays the steps.
4. Prints the game log, the table's questions, the priority buttons it saw (`P` lines), the expected lines
   (OK/MISS), the bridge errors, and the invariant violations of that run.

Each plan's `note` starts with **SEE:**, what the player must be able to see on the table for that plan to pass. This is
the human check: a screenshot after the run.

## The plans

"Steps" are the checks (60 in all); "lines" are the expected lines (119).

| id | what it checks | steps | lines | cards (AI: = the AI's) | the player must see |
|---|---|---|---|---|---|
| ab-01 | Mana abilities that don't tap (Kykar #1, #2) | 3 | 10 (8 live, 2 proposed) | Kykar, Wind's Fury + 2 Spirit tokens, Ashnod's Altar, Phyrexian Altar, Grizzly Bears, Lotus Petal, Simian Spirit Guide, Divination | what was sacrificed, that it paid for mana; no "tap" label on a sacrifice or exile cost |
| ab-02 | Pain lands and Ancient Tomb (Kykar #4) | 3 | 5 (1 live, 4 proposed) | Adarkar Wastes, Shivan Reef, Ancient Tomb, Wastes, Raise the Alarm, Shock, Mind Stone | which mana costs life before paying; the land named on each life line |
| ab-03 | Equip and Auras; numbered token lists (Kykar #3, #9) | 3 | 6 (5 live, 1 proposed) | Skullclamp, Lightning Greaves, Grizzly Bears, 11 Spirit tokens, Pacifism, AI: Hill Giant | the equip target even when it dies at once; the Aura's host; #1, #2 ... #10 in order |
| ab-04 | Choose a source and redirect (Kykar #5, #6) | 2 | 7 (4 live, 3 proposed) | Reflect Damage, Prodigal Sorcerer | only real sources offered; the source chosen; damage aimed at AI 1 hitting White, and why |
| ab-05 | Choose a source and prevent | 2 | 4 (3 live, 1 proposed) | Circle of Protection: Red, Prodigal Pyromancer | the red source chosen; that its damage was prevented |
| ab-06 | Noncombat damage at creatures and players (Kykar #8, #11) | 4 | 5 (1 live, 4 proposed) | Vulshok Sorcerer, Prodigal Sorcerer, Shock, Lightning Bolt, AI: Craw Wurm, Hill Giant | what dealt damage to what, including a creature that survives |
| ab-07 | Counter and copy (Kykar #8) | 4 | 6 (5 live, 1 proposed) | Shock x2, Counterspell, Twincast | what was countered or copied; the copy's own target |
| ab-08 | Unless that player pays (Kykar #7) | 1 | 5 (2 live, 3 proposed) | Opt, AI: Rhystic Study, Esper Sentinel | who was asked to pay how much, whether they paid, why someone drew |
| ab-09 | Revealed cards and two piles (Kykar #10) | 1 | 5 (4 live, 1 proposed) | Fact or Fiction | the five names, the split, the pile taken, by name |
| ab-10 | Control vs ownership (Kykar #12) | 2 | 4 (3 live, 1 proposed) | Threaten, Chaos Warp, AI: Craw Wurm | the owner's library named, not the controller's |
| ab-11 | The opponent chooses: edict, discard | 2 | 4 (3 live, 1 proposed) | Diabolic Edict, Mind Rot, AI: Grizzly Bears, Hill Giant | what the opponent gave up, and which spell made them |
| ab-12 | Scry and look (hidden information) | 2 | 4 (4 live) | Opt, Impulse | how many cards went where, with hidden cards unnamed |
| ab-13 | Type, colour and name choices | 3 | 4 (2 live, 2 proposed) | Herald's Horn, Thriving Isle, Pithing Needle, Icy Manipulator | the choice made, said once |
| ab-14 | Tap, untap, animate | 3 | 4 (1 live, 3 proposed) | Icy Manipulator, Kiora's Follower, Mutavault, AI: Hill Giant | what got tapped or untapped by what; a land that is now a creature |
| ab-15 | Wipes and regeneration | 3 | 4 (3 live, 1 proposed) | Drudge Skeletons, Grizzly Bears, Pyroclasm, Wrath of God, AI: Hill Giant, Craw Wurm | what each wipe hit; the survivor's damage |
| ab-16 | Drain and life payment | 2 | 4 (2 live, 2 proposed) | Sovereign's Bite, Sign in Blood | why each life total moved |
| ab-17 | Pump and tokens | 3 | 3 (2 live, 1 proposed) | Grizzly Bears, Giant Growth, Raise the Alarm, Overrun | the new P/T on the cards (card face, not log) |
| ab-18 | Mill, loot, draw | 2 | 4 (4 live) | Thought Scour, Faithless Looting | which cards were milled and discarded |
| ab-19 | Library searches | 3 | 4 (3 live, 1 guess) | Demonic Tutor, Rampant Growth, Cultivate | a hidden search stays hidden; a revealed one names its cards |
| ab-20 | Moving permanents between zones | 4 | 4 (3 live, 1 proposed) | Animate Dead, Regrowth, Unsummon, Swords to Plowshares, graveyard Craw Wurm, Divination, AI: Hill Giant, Grizzly Bears | where each card came from and went; Animate Dead's host |
| ab-21 | Costs paid with other permanents | 2 | 4 (3 live, 1 proposed) | Goblin Bombardment, Ornithopter, Grizzly Bears, Village Rites | what was given up and what it paid for (the contrast with ab-01) |
| ab-22 | Mana with an extra cost | 1 | 4 (3 live, 1 guess) | Springleaf Drum, Grizzly Bears, Azorius Signet, Horizon Canopy, Divination | every payment button says everything it costs |
| ab-23 | Combat damage names its source (INV-1) | 2 | 4 (2 live, 2 proposed) | Hill Giant, Grizzly Bears | which creature dealt how much to whom |
| ab-24 | Loyalty abilities and split halves (Kykar #13, #14) | 2 | 7 (4 live, 3 proposed) | Ral Zarek, Expansion // Explosion, AI: Hill Giant | which loyalty ability, the loyalty change, the target; only the half cast |
| ab-25 | Replacement order; cost wording (Kykar #17, #18) | 1 | 4 (3 live, 1 proposed) | Anointed Procession, Mondrak, Glory Dominus, Ornithopter, Grizzly Bears, Raise the Alarm | which card's replacement goes first, by name; the token count |

**Names and setups.**
- All 70 card names were checked against Forge's script `Name:` lines. "Expansion // Explosion" is the split card's
  full name, as the Kykar deck and scenarios use it.
- The token script `w_1_1_spirit_flying` exists in `bridge/token-scripts.json`.
- Plans with `mana: 0` pay from real lands only, so the payment question shows the labels under test.

## Always-on invariants

`tmp/log-invariants.js` checks these on every saved report. `ability-run.js` also runs them on each new report, and
lists them without scoring them. Each one is a rule the table should never break, for any card.

| id | rule | how it is detected | why |
|---|---|---|---|
| INV-1 | a life loss names its source | a `X: a -> b life (-n)` line with nothing after the number and no "deals N damage to X" / "loses" / "pays N life" line within 2 lines (gains are not checked) | the player can't tell a pain land from a ping from combat |
| INV-2 | an Equip/Aura attach names its target | "uses <Equipment>'s ability" with no "attached to" within the next 4 lines, or an Aura entering with no "attached to" | Kykar #3: the equipped token died first and nothing said what was equipped |
| INV-3 | no Forge separator row is offered as an option | an option matching `^--[A-Z ]+:--$` ("--PERMANENTS:--"); a real choice like "-- Pile 1 (0 cards) --" is allowed | Kykar #5: a separator is pickable and does nothing |
| INV-4 | a "tap" label only for a mana ability that taps | "Mana: tap X" or "Tap X" where every mana ability of X's script lacks {T} | Kykar #1 |
| INV-5 | "(to pay for X)" only when X is being paid for | "... is sacrificed (to pay for X)" where X has a sacrifice-cost mana ability | Kykar #2: the sacrifice paid for mana, not for Kykar |
| INV-6 | two options in one question never read the same | duplicate labels, except in fungible questions (payments, searches, discards, scry piles) | the player can't tell which copy they pick |
| INV-7 | a chosen source is logged | a ChooseSource card's cast or ability with no "chooses" / "source" within the next 6 lines | Kykar #6 |
| INV-8 | a targeted spell's cast line names its target | "<player> casts X" where X's script has `SP$ ... ValidTgts# Ability sweep: spec, always-on invariants, results (prep, 2026-11-07)

The keyword sweep (25 plans) and the mechanic runs (28 decks) found no rules bugs: every bug was a **table** bug, in
log wording, button labels or prompt options. The Kykar play-test (docs/HAND-TEST-KYKAR.md) found more of them, and
none came from a keyword. They came from ordinary card shapes: a mana ability with no {T}, a pain land, an equip
whose target dies at once, a "choose a source" prompt. This sweep goes by Forge **ability type** (ApiType) and
**cost / prompt shape** instead.

**This is preparation only.** Nothing was run on the real table, in TTS or against the live stack. The live engine
text below comes from my own relay and node containers (the same images as the live stack). They were removed
afterwards.

## Files

| file | what it is |
|---|---|
| `docs/ability-type-census.md` | ApiType and shape counts over Commander-legal scripts, ranked by card count, with played / checked columns (generated) |
| `tmp/ability-census.js`, `tmp/ability-census.json` | the census generator, plus its raw rows and full card lists (each played/checked credit can be audited there) |
| `tmp/ability-probe.js`, `tmp/ability-probe.sh` | the live-text probe: 34 steps on own containers, replayed through `bridge.js` offline (tests/bridge-harness.js) |
| `tmp/ability-probe-report.txt` | for every probe step: the engine prompt (raw), the table's question, and the table's log lines |
| `tmp/ability-sweep-plan.json` | the plan list: 25 plans, 60 steps, 119 expected lines (kw-sweep-plan.json's keys and setup keys) |
| `tmp/ability-run.js` | a copy of `tmp/kw-run.js` that runs one plan (kw-run.js itself is unchanged) |
| `tmp/log-invariants.js` | the always-on checks over saved reports; also called by `ability-run.js` at the end of every run |

## Where the expected text comes from

Each expected line starts with a tag:

- **`[live]`** — text seen from the real engine plus the current `bridge/bridge.js`. Sources: the probe
  (`tmp/ability-probe-report.txt`), the Kykar notes, the kw/mech reports, and `tests/live_events_check.js`.
- **`[proposed ...]`** — the wording a fix should produce. This is a target, not a guess at today's text: align it with
  whatever wording the fix chooses. The tag names the Kykar bug it comes from.
- **`[guess]`** — 2 lines whose live text nobody has seen yet:
  - Rampant Growth's land line;
  - Azorius Signet's payment label.

  Pin them after the first run.

**Grammar (only in `ability-run.js`).**
- **Notes in parentheses.** Parentheses outside quotes are notes and are never matched, so a note can quote today's
  wrong text.
- **Matching.** Every quoted fragment outside the notes must appear (a positive check). If the line's own words outside
  the notes say "not", "no" or "never", none of them may appear (a negative check).
- **kw-run.js.** It would also try to match the quotes inside the notes, so run this plan with `ability-run.js`.

**What a run shows before any fix.**
- `[live]` positive lines: OK.
- `[live]` negative lines on known-bad text: MISS. That is the bug, still there.
- `[proposed]` lines: MISS.

After a fix, all three should be OK.

**Caveats on the probe text.**
- **Seat names.** The offline replay has no seat list, so it shows engine usernames ("abl-probe-0-...") or "Red"
  where the table shows "White" or "AI 1". The plans use the table's names.
- **Answer-time lines.** Lines the bridge writes only when the table answers a question are not reproduced by the
  replay: scry's "White scries 1: ..." and "White chooses X (card)". For these the plans use the wording the kw sweep
  saw live.
- **Log windows.** The probe's per-step log windows lag by about one step. For example, painland's damage line is
  printed under the painland step, and Raise the Alarm's payment under the Kykar step.
- **Painland step.** It hit "stuck in resolve" in the probe. It still paid (Adarkar Wastes + Battlefield Forge), and
  its label and life line were captured.

## How to run (later, not now)

**Preconditions.** One plan per TTS launch (memory: the first game per launch adds about 11k objects). No game may be
running. The table must be in its usual debug state, as for `kw-run.js`.

```
node tmp/ability-run.js tmp/ability-sweep-plan.json ab-01      # report: tmp/ability-runs/ab-01.txt
```

**What the runner does.**
1. Writes `scenarios/<id>.json` and `tmp/wt-head/scenarios/<id>.json`.
2. Resets the room, starts White against one AI, and applies the setup.
3. Plays the steps.
4. Prints the game log, the table's questions, the priority buttons it saw (`P` lines), the expected lines
   (OK/MISS), the bridge errors, and the invariant violations of that run.

Each plan's `note` starts with **SEE:**, what the player must be able to see on the table for that plan to pass. This is
the human check: a screenshot after the run.

## The plans

"Steps" are the checks (60 in all); "lines" are the expected lines (119).

| id | what it checks | steps | lines | cards (AI: = the AI's) | the player must see |
|---|---|---|---|---|---|
| ab-01 | Mana abilities that don't tap (Kykar #1, #2) | 3 | 10 (8 live, 2 proposed) | Kykar, Wind's Fury + 2 Spirit tokens, Ashnod's Altar, Phyrexian Altar, Grizzly Bears, Lotus Petal, Simian Spirit Guide, Divination | what was sacrificed, that it paid for mana; no "tap" label on a sacrifice or exile cost |
| ab-02 | Pain lands and Ancient Tomb (Kykar #4) | 3 | 5 (1 live, 4 proposed) | Adarkar Wastes, Shivan Reef, Ancient Tomb, Wastes, Raise the Alarm, Shock, Mind Stone | which mana costs life before paying; the land named on each life line |
| ab-03 | Equip and Auras; numbered token lists (Kykar #3, #9) | 3 | 6 (5 live, 1 proposed) | Skullclamp, Lightning Greaves, Grizzly Bears, 11 Spirit tokens, Pacifism, AI: Hill Giant | the equip target even when it dies at once; the Aura's host; #1, #2 ... #10 in order |
| ab-04 | Choose a source and redirect (Kykar #5, #6) | 2 | 7 (4 live, 3 proposed) | Reflect Damage, Prodigal Sorcerer | only real sources offered; the source chosen; damage aimed at AI 1 hitting White, and why |
| ab-05 | Choose a source and prevent | 2 | 4 (3 live, 1 proposed) | Circle of Protection: Red, Prodigal Pyromancer | the red source chosen; that its damage was prevented |
| ab-06 | Noncombat damage at creatures and players (Kykar #8, #11) | 4 | 5 (1 live, 4 proposed) | Vulshok Sorcerer, Prodigal Sorcerer, Shock, Lightning Bolt, AI: Craw Wurm, Hill Giant | what dealt damage to what, including a creature that survives |
| ab-07 | Counter and copy (Kykar #8) | 4 | 6 (5 live, 1 proposed) | Shock x2, Counterspell, Twincast | what was countered or copied; the copy's own target |
| ab-08 | Unless that player pays (Kykar #7) | 1 | 5 (2 live, 3 proposed) | Opt, AI: Rhystic Study, Esper Sentinel | who was asked to pay how much, whether they paid, why someone drew |
| ab-09 | Revealed cards and two piles (Kykar #10) | 1 | 5 (4 live, 1 proposed) | Fact or Fiction | the five names, the split, the pile taken, by name |
| ab-10 | Control vs ownership (Kykar #12) | 2 | 4 (3 live, 1 proposed) | Threaten, Chaos Warp, AI: Craw Wurm | the owner's library named, not the controller's |
| ab-11 | The opponent chooses: edict, discard | 2 | 4 (3 live, 1 proposed) | Diabolic Edict, Mind Rot, AI: Grizzly Bears, Hill Giant | what the opponent gave up, and which spell made them |
| ab-12 | Scry and look (hidden information) | 2 | 4 (4 live) | Opt, Impulse | how many cards went where, with hidden cards unnamed |
| ab-13 | Type, colour and name choices | 3 | 4 (2 live, 2 proposed) | Herald's Horn, Thriving Isle, Pithing Needle, Icy Manipulator | the choice made, said once |
| ab-14 | Tap, untap, animate | 3 | 4 (1 live, 3 proposed) | Icy Manipulator, Kiora's Follower, Mutavault, AI: Hill Giant | what got tapped or untapped by what; a land that is now a creature |
| ab-15 | Wipes and regeneration | 3 | 4 (3 live, 1 proposed) | Drudge Skeletons, Grizzly Bears, Pyroclasm, Wrath of God, AI: Hill Giant, Craw Wurm | what each wipe hit; the survivor's damage |
| ab-16 | Drain and life payment | 2 | 4 (2 live, 2 proposed) | Sovereign's Bite, Sign in Blood | why each life total moved |
| ab-17 | Pump and tokens | 3 | 3 (2 live, 1 proposed) | Grizzly Bears, Giant Growth, Raise the Alarm, Overrun | the new P/T on the cards (card face, not log) |
| ab-18 | Mill, loot, draw | 2 | 4 (4 live) | Thought Scour, Faithless Looting | which cards were milled and discarded |
| ab-19 | Library searches | 3 | 4 (3 live, 1 guess) | Demonic Tutor, Rampant Growth, Cultivate | a hidden search stays hidden; a revealed one names its cards |
| ab-20 | Moving permanents between zones | 4 | 4 (3 live, 1 proposed) | Animate Dead, Regrowth, Unsummon, Swords to Plowshares, graveyard Craw Wurm, Divination, AI: Hill Giant, Grizzly Bears | where each card came from and went; Animate Dead's host |
| ab-21 | Costs paid with other permanents | 2 | 4 (3 live, 1 proposed) | Goblin Bombardment, Ornithopter, Grizzly Bears, Village Rites | what was given up and what it paid for (the contrast with ab-01) |
| ab-22 | Mana with an extra cost | 1 | 4 (3 live, 1 guess) | Springleaf Drum, Grizzly Bears, Azorius Signet, Horizon Canopy, Divination | every payment button says everything it costs |
| ab-23 | Combat damage names its source (INV-1) | 2 | 4 (2 live, 2 proposed) | Hill Giant, Grizzly Bears | which creature dealt how much to whom |
| ab-24 | Loyalty abilities and split halves (Kykar #13, #14) | 2 | 7 (4 live, 3 proposed) | Ral Zarek, Expansion // Explosion, AI: Hill Giant | which loyalty ability, the loyalty change, the target; only the half cast |
| ab-25 | Replacement order; cost wording (Kykar #17, #18) | 1 | 4 (3 live, 1 proposed) | Anointed Procession, Mondrak, Glory Dominus, Ornithopter, Grizzly Bears, Raise the Alarm | which card's replacement goes first, by name; the token count |

**Names and setups.**
- All 70 card names were checked against Forge's script `Name:` lines. "Expansion // Explosion" is the split card's
  full name, as the Kykar deck and scenarios use it.
- The token script `w_1_1_spirit_flying` exists in `bridge/token-scripts.json`.
- Plans with `mana: 0` pay from real lands only, so the payment question shows the labels under test.

## Always-on invariants

`tmp/log-invariants.js` checks these on every saved report. `ability-run.js` also runs them on each new report, and
lists them without scoring them. Each one is a rule the table should never break, for any card.

| id | rule | how it is detected | why |
|---|---|---|---|
| INV-1 | a life loss names its source | a `X: a -> b life (-n)` line with nothing after the number and no "deals N damage to X" / "loses" / "pays N life" line within 2 lines (gains are not checked) | the player can't tell a pain land from a ping from combat |
| INV-2 | an Equip/Aura attach names its target | "uses <Equipment>'s ability" with no "attached to" within the next 4 lines, or an Aura entering with no "attached to" | Kykar #3: the equipped token died first and nothing said what was equipped |
| INV-3 | no Forge separator row is offered as an option | an option matching `^--[A-Z ]+:--$` ("--PERMANENTS:--"); a real choice like "-- Pile 1 (0 cards) --" is allowed | Kykar #5: a separator is pickable and does nothing |
| INV-4 | a "tap" label only for a mana ability that taps | "Mana: tap X" or "Tap X" where every mana ability of X's script lacks {T} | Kykar #1 |
| INV-5 | "(to pay for X)" only when X is being paid for | "... is sacrificed (to pay for X)" where X has a sacrifice-cost mana ability | Kykar #2: the sacrifice paid for mana, not for Kykar |
| INV-6 | two options in one question never read the same | duplicate labels, except in fungible questions (payments, searches, discards, scry piles) | the player can't tell which copy they pick |
| INV-7 | a chosen source is logged | a ChooseSource card's cast or ability with no "chooses" / "source" within the next 6 lines | Kykar #6 |
| INV-8 | a targeted spell's cast line names its target |  and the line has no "targeting", "on" or "at" | Kykar #8 |
| INV-9 | an "unless pays" outcome is logged | an UnlessCost$ (another player may pay) card's cast or trigger with no "pays" / "doesn't pay" / "declines" within the next 6 lines | Kykar #7 |
| INV-10 | revealed cards stay named when they move | "puts N cards from their library into their hand" within 3 lines of a "reveals" | Kykar #10 |
| INV-11 | "#n" labels are in number order | options "Name #1, #10, #2" | Kykar #9 |
| INV-12 | a source choice is titled as one | "<ChooseSource card>: choose a card" | Kykar #5 |
| INV-13 | a painful mana label says the damage | "Tap X for {c}" with no "damage" or "life", where X's script deals damage for that colour | Kykar #4 |

**Running the checker.**

```
node tmp/log-invariants.js                 # all saved reports + the Kykar session logs
node tmp/log-invariants.js --no-session    # without tmp/tts-stream.jsonl / tmp/table-log.log
node tmp/log-invariants.js --all --json out.json  [report.txt ...]
```

**Inputs.**
- `tmp/kw-runs/*.txt`
- `tmp/mech-runs/mech-*.txt` and `tmp/mech-runs/first/*.txt`
- `tmp/ability-probe-report.txt`
- the back-quoted strings in `docs/HAND-TEST-KYKAR.md`
- unless `--no-session`, the Kykar session:
  - the game log in `tmp/tts-stream.jsonl` from the first `debug setup "kykar` line;
  - the questions and answers in `tmp/table-log.log` from the first `kykar_winds_fury` line.

The checker only reads. The session files are the running play-test's own logs, so their counts are a snapshot
(2026-11-07 01:16 EST).

## Results (run 2026-11-07 01:16)

- **With the session:** 99 sources, 5,482 lines read.
- **Without it (`--no-session`):** 98 sources, 3,867 lines.

Counts are violations; "distinct" counts unique flagged lines.

| id | with session | no session | by source (with session) | examples (file:line) |
|---|---|---|---|---|
| INV-1 | 360 | 164 | kw 76, mech 75, probe 8, Kykar notes 5, session 196 | `tmp/kw-runs/kw-02.session2.txt:75` "AI 1: 38 -> 34 life (-4)" after "White casts Galvanic Blast"; `tmp/ability-probe-report.txt:17` "White: 40 -> 39 life (-1)" (pain land) |
| INV-2 | 3 | 2 | probe 1, notes 1, session 1 | `tmp/ability-probe-report.txt:89` "White uses Skullclamp's ability", no attach line |
| INV-3 | 9 | 7 | probe 5, notes 2, session 2 | `tmp/table-log.log:122440` "Reflect Damage: choose a card": --PERMANENTS:-- \| --SPELLS ON THE STACK:-- \| ...; probe adds a third, "--CARDS IN THE COMMAND ZONE:--" |
| INV-4 | 132 (4 distinct) | 131 | probe 130, notes 1, session 1 | "Mana: tap Kykar, Wind's Fury", "Mana: tap Ashnod's Altar", "Mana: tap Phyrexian Altar", "Mana: tap Simian Spirit Guide" |
| INV-5 | 6 (2 distinct) | 5 | probe 4, notes 1, session 1 | "Spirit token is sacrificed (to pay for Kykar, Wind's Fury)"; "Grizzly Bears is sacrificed (to pay for Ashnod's Altar)" |
| INV-6 | 49 (29 distinct) | 36 | kw 14, mech 21, probe 1, session 13 | `kw-19.txt:140` attackers "Goat Token → AI 1" x2; `mech-rebuilt.txt:106` "Legend rule: which Mairsil, the Pretender stays?" x2; probe CoP list "Rograkh, Son of Rohgahh 0/1" x2 (one per player); session "Spirit Token blocks Hill Giant" x4 |
| INV-7 | 3 | 2 | probe 2, session 1 | "White casts Reflect Damage", "White uses Circle of Protection: Red's ability": no line names the source |
| INV-8 | 104 (49 distinct) | 92 | kw 43, mech 36, probe 11, notes 2, session 12 | "White casts Prey Upon", "White casts Swords to Plowshares", "White casts Chaos Warp", "White casts Counterspell" |
| INV-9 | 13 | 7 | mech 5, probe 2, session 6 | `mech-hp08.txt:23` Acererak; `mech-hp23.txt:36` Minds Aglow; session Esper Sentinel, Rhystic Study, Mystic Remora |
| INV-10 | 8 (1 distinct text) | 5 | kw 1, mech 4, session 3 | `kw-25.txt:52` "White puts a card from their library into their hand" after a reveal; session "White puts 3 cards from their library into their hand" (FoF) |
| INV-11 | 11 | 0 | session 11 | `tmp/table-log.log:122485` "Spirit Token 2/2 (token) #1, #10, #11, #12 ... #2"; Niv-Mizzet targets "Elemental Token #1, #10, #2" |
| INV-12 | 4 | 3 | probe 2, notes 1, session 1 | "Reflect Damage: choose a card", "Circle of Protection: Red: choose a card" |
| INV-13 | 35 (6 distinct) | 32 | probe 29, notes 3, session 3 | "Tap Adarkar Wastes for {W}", "Tap Battlefield Forge for {R}", "Tap Ancient Tomb for {C}{C}", "Tap Shivan Reef for {U}" |

**Reading the counts.**
- **INV-1 is the big one.** Of its 360 (none was classed as combat: the checker looks back up to 8 lines for an attack arrow):
  - 45 follow a spell;
  - 9 follow an activated ability;
  - 294 follow a trigger line (mostly the session's Kykar/Niv-Mizzet/Impact Tremors turns);
  - 12 have nothing before them that could explain them (for example `kw-10.txt:81-85`, three "AI 1: -1" in a row;
    `kw-12.txt:32` "White: 40 -> 34 life (-6)").

  The line format has no source at all: `${who}: ${before} -> ${l} life (±n)` in `bridge.js`. So every life change is
  a violation until the line gets one.
- **INV-8 is just as general.** No cast line ever names a target.
- **INV-4 and INV-13 are counted once per question shown.** The probe repeats the same priority list on every step,
  so use the distinct counts.
- **INV-6 is the noisiest.** Identical untapped basics in one target list (Forest x8 for Wild Growth) are harmless.
  The real cases are copies that differ: owner (Rograkh x2, Expropriate's Islands), legend rule (Mairsil x2), or
  separate attackers.

## New findings from the probe (not in the Kykar notes)

1. **Prevention leaves no trace.** Circle of Protection: Red prevented Prodigal Pyromancer's damage to White, and no
   line was logged at all.
2. **A countered own spell leaves no trace.** White's Counterspell on White's own Shock was followed by no
   "is countered" line. (Kykar's AI case did log "Marble Diamond is countered".)
3. **Hidden X.** Esper Sentinel's question is "Esper Sentinel: pay {X}?" with a "Pay {X}" button. X is its power (1),
   so the player never sees the amount.
4. **Vague colour title.** Thriving Isle's colour question has the bare card name as its title, and the text
   "Play land".
5. **Vague split prompt.** In Fact or Fiction, the opponent's split question is "Fact or Fiction: choose up to 5
   cards". It does not say that these cards form pile 1.
6. **Wipe damage is unlogged.** Pyroclasm logs only the deaths: a 3/3 that survives with 2 damage has no line.
7. **Tap, untap and animate are unlogged.** Icy Manipulator, Mutavault and Kiora's Follower log only "White uses X's
   ability".
8. **Edict has no cause.** Diabolic Edict logs "Hill Giant is sacrificed" without the spell that made the player
   sacrifice it.
9. **Drain has no source.** Sovereign's Bite's life lines have no source.
10. **Kykar #12 reproduced.** "Craw Wurm is put into White's library" after Threaten + Chaos Warp: the line names
    the controller, not the owner.
11. **A third separator.** "--CARDS IN THE COMMAND ZONE:--" shows up as a separator alongside the Kykar notes' two.
12. **Lotus Petal hides its sacrifice.** Its button is "Mana: tap Lotus Petal". That is true, but it doesn't say the
    Petal is sacrificed. The payment list already says "Use Phyrexian Altar for {W} (sacrifice a creature)", so the
    words exist.
13. **Kykar #9 reproduced.** Same-named tokens sort as text: "#1, #10, #11, #2".

## What could not be measured

- **Exact Commander legality.** Forge has no legality data per card and no Scryfall data here. The census uses an
  approximation (see its header):
  - 85 banned, 230 rebalanced, 1,067 Funny/Online-only, 290 never printed, 449 odd types dropped;
  - error sources are named there.
- **Abilities built in Java.** The census counts only abilities written in scripts. Equip's Attach, Cycling,
  Treasure's mana and similar are built in Java and not counted as ApiTypes. Equip, Enchant, Bestow, Reconfigure and
  Fortify are added by hand from `K:` lines.
- **"Checked" is a heuristic.** An OK expect line is tied to a card by name or by its Mechanic prefix, and its text
  must match a per-type regex. It can credit the wrong one of a card's types. The census measures checks per ApiType
  only, never per shape.
- **The probe is not the real table.**
  - Answer-time lines (scry, "chooses") and the seat names are not reproduced by the replay. The probe's per-step
    log windows lag by about one step.
  - Each plan's step sequence was not run end to end. The runner's parsing of each step was checked offline (card
    names, hints, expect fragments), but not its play.
- **Script-driven invariants.** INV-4, INV-5, INV-7, INV-8, INV-9 and INV-13 decide from Forge's scripts:
  - they only know what a script says (a keyword-built mana ability is invisible to them);
  - INV-8 cannot tell a cast line that should name "target player: you" from one that should name a creature.
- **Things the invariants can't decide.**
  - INV-6 can't tell harmless identical basics from copies that really differ (owner, tapped state, counters).
  - INV-1 can't tell combat from noncombat damage.
  - No invariant checks owner vs controller (Kykar #12). The text alone can't decide it; ab-10 checks it by hand.
- **Not probed, so no plan.** ChooseNumber (54 cards), GenericChoice (127), ChoosePlayer (110), ChooseCard across
  mixed zones (4), Fortify (2), Reconfigure (17) and Bestow (43). Their live prompt text is unknown, and plans written
  now would be guesses.
- **The Kykar play-test is still running.** Its later bugs (after #18) and the session counts above will change.
- **The Kykar engine bug (#15, runaway cap) and the game-over wording (#16).** Neither is in this sweep. #15 is a
  rules/engine cap; #16 needs a game end.
