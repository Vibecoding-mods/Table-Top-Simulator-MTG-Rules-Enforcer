# Cost-change counter on cards (spec, item 13)

Status: design only, written 2026-11-11. No code changed. Source item: docs/next-features-2026-11-09.md, item 13.

## What the user sees

- The user's design (2026-11-11): the badge looks like a counter token, the way the Mindsplice app draws them (the user's reference). Until that look is matched, use the table's own counter box and font (the counters already on cards). It sits ON the grey colorless (generic) mana symbol and covers it, so the card reads as its new cost.
- Examples, printed {2}{R}{R}: taxed by one, the counter over the 2 says 3 (taxed more: 4, 5 ...), so it reads 3 colorless red red. Cheapened by two, the counter says 0, so it reads 0 colorless red red. The red symbols are untouched.
- The number is the whole new colorless amount, not the difference ("3", never "+1").
- Cheaper or dearer is told by a thin green or red rim on the counter only; the box itself is the normal counter colour. (Default; drop the rim if it looks wrong on the real table.)
- Same cost as printed: no counter at all.
- Your commander in the command zone shows its tax the same way. Printed {2}{U}{R} after two casts shows a counter saying 6 over the 2.
- A card with no colorless symbol (printed {R}) under Thalia: there is nothing to cover, so a counter saying 1 sits just left of the red symbol, where a colorless symbol would be.
- A change to a coloured symbol (Emerald Medallion takes one {G} off a green spell) shows a small green chip left of the symbols: "-G". The generic badge is not touched.
- Hover the badge or the card: the hover text says "Costs {2}{G} now (printed {2}{G}{G})".
- The badge is display only. The engine still decides and asks for the real payment. If the badge and the payment prompt disagree, the prompt is right.
- Phase 1 covers your hand, your commander in the command zone, and the top card of your library when you may play it. Phase 2 covers cards you may cast from your graveyard or exile.
- Other players' hands: you see nothing (you can't see the cards). A hand that is revealed to the table shows its badges too.

## Findings: what exists today

### The age-counter badge

- Drawn by `updateBadge` and `badgeParts` in tools/engine-renderer.lua (about lines 264-402).
- "Age" is only one name in `COUNTER_NAMES` (line 254). The badge is the dark-blue counter box (`ctr`) at the top right of a card, position `BADGE.ctr = { 0.6, 0.3, -1.12 }`.
- Each badge is a TTS button on the card object: `o.createButton` with a label, a colour and a tooltip. `badgeText` makes one string per card. `engineBadge[id]` stores it. If the string is the same on the next board, nothing is redrawn.
- Important: `updateBadge` draws only for `zone == "battlefield"` (line 360). For any other zone the text is empty.
- Important: a card that is in a hand returns early in `place` (lines 499-506) before `updateBadge` is called. So hand cards get no badges, and no redraw, today. This is the main new work.
- The first spawn calls `updateBadge` through `engineCardEntry` with the zone "hand", which draws nothing.
- Local-variable limit: tools/engine-renderer.lua has about 186 of 200 main-chunk locals. New code must use globals or fields of an existing table (agent rules).

### What cost data reaches the table

- The engine already sends it. Forge's harness writes `CardDto.effectiveManaCost` in `InteractiveSnapshotExtractor.toCard` (manabrew/forge-harness/.../InteractiveSnapshotExtractor.java, line 894, method at 1038).
- How it is computed: `CostAdjustment.adjust(copy of the first spell ability's cost, sa, false)`, so it includes every cost reduction and increase that Forge itself applies, and the commander tax (CostAdjustment.java line 58 adds 2 per earlier cast). It returns a mana string such as `{R}{R}`. It returns null when the result equals the printed cost, when the card is a land, face-down, or has no spell ability, and on any exception.
- It is filled only when `castable` is true for the zone. That is: hand (`zoneWithVisibility("hand", ... true)`), command zone (line 201), and the library top card when the viewer may see it (line 210). It is NOT filled for graveyard, exile, stack, battlefield (all pass false).
- `CardDto.commanderTax` is also sent (2 x casts) for commanders.
- The bridge drops both. bridge/table-map.js says `effectiveManaCost: { skip: "the mana question shows what is to pay" }` and `manaCost: { skip: "in the picture" }`. The bridge's table card (tableCard, bridge.js about lines 1195-1230, and the hand/command `toCard` at about 3466-3488) carries `cmc` only. The player's tax is sent as `tax` per commander (line 3473) for the tax counter on the mat, not per card.
- The cast action (`cast{cardId, mode, label}`, docs/engine-interface-reference.md line 271) carries no cost. The only place Forge states the real cost of an action is the later `payManaCost` prompt (`manaCost`, `input.manaCost` in bridge.js line 5046), which is after the player has chosen to cast. Too late for a badge.
- The `:costs` image directive (PLAN.md lines 87 and 117) is not related. It sends the causes of card movements (foretell, plot, suspend), not mana costs.
- Not verified: no recorded board in tests/golden (bridge_golden.json, table_golden.json, fixtures) contains the string `effectiveManaCost`. I could not confirm from a recording that the field reaches the bridge through the relay. Step 1 below checks this on a real board.

## How to build it

### Step 0: prove the data arrives (no code change to ship)

- In debug mode (`mtg debug`), put Thalia, Guardian of Thraben on the table and a noncreature spell in hand. Read the board the bridge receives (GET /state or the bridge log) and look for `effectiveManaCost` on the hand card.
- Do the same for a commander with one cast, a "2 less" source, and a card that costs 0 after reductions (see Risks).
- Save one board of each as a fixture under tests/golden/fixtures.

### Step 1: bridge (bridge/bridge.js, bridge/table-map.js)

- Add field `ec` to the hand card, the command-zone card and the playable-from-library-top card. Value: the effective cost string, only when it differs from the printed one.
- Add `mc` (the printed cost string) next to it, because the renderer needs both to tell cheaper from dearer and to find the generic part. `manaCost` is already on the engine card.
- Change the table-map entries: `effectiveManaCost` and `manaCost` become `{ to: ["ec", "mc"], show: "...", check: "..." }`. tests/test_table_map.js then forces a matching `check` line in `engineSelfCheck`.
- The slimmer (bridge.js `slimmer`, line 3413) sends static details once and changing ones each board. `ec` changes with the board, so it belongs in the changing part. The hover text can include it too.
- Cost on the commander: `ec` already contains the tax. `tax` stays as it is for the mat counter.

### Step 2: pure cost-compare function

- One Lua function (a field of an existing table, not a new local): `engineCostChange(mc, ec)` returns nil or a table `{ generic = n or nil, dir = "less" or "more", colour = { "G", ... }, text = "..." }`.
- Parse both strings into pips: `{N}` generic, `{X}`, coloured `{W}{U}{B}{R}{G}{C}`, hybrid `{2/W}` `{W/U}`, Phyrexian `{W/P}`, snow `{S}`. Use plain `find` and `sub` in a loop over `{...}` groups, not a heavy pattern (MoonSharp pattern traps).
- Generic amount = sum of `{N}` tokens. X is not counted.
- Compare generic sums: different means a generic badge with the new sum. Compare the coloured multisets: different means a coloured chip.
- Direction: effective total value (generic + each other pip as 1) lower than printed means "less" (green), higher means "more" (red). If the generic goes down and a colour goes up, red wins and the tooltip says both.
- Cases:
  - {2}{R}{R} to {R}{R}: generic 2 to 0, "less". Badge "0".
  - {R} to {1}{R} (Thalia): printed has no generic. Badge "1", "more". It sits left of the first pip.
  - {2}{G}{G} to {2}{G} (Emerald Medallion): colour chip "-G".
  - {X}{R} to {1}{X}{R} (a tax): generic from 0 to 1, badge "1".
  - {X}{R} under a reduction: Forge cannot reduce below X, so the cost is unchanged and no badge shows. The real saving appears at payment.
  - Commander tax: {2}{U}{R} to {6}{U}{R}: badge "6", "more".

### Step 3: renderer (tools/engine-renderer.lua)

- Extend `badgeParts` with a part `cost`, or a separate function `engineCostParts(c)`. Hand and command cards call it; battlefield cards do not.
- `updateBadge` must run for zone "hand" and "command", not only "battlefield". Change line 360 so the badge text for those zones is the cost part only. Add the cost string to the signature so `engineBadge[id]` notices a change.
- Hand path in `place` (lines 499-506): after the early return was reached, call a small refresh (`engineCostBadge(o, c)`) that compares the signature and redraws only when it changed. This runs on every board but costs one string compare per hand card.
- When the redraw needs `o.clearButtons()`: hand and command cards carry no other buttons today (ability buttons are drawn for the battlefield only; check `engineAbilitySig` and `engineAbilityButtons` for hand cards before relying on this). If a hand card does carry ability buttons, use `editButton` or remove only the cost button by index, as `engineGroupShown` does.
- Where the badge sits. The mana cost is in the title bar at the top right, the same side as the age box but higher. The age/counter box is at z = -1.12 (just below the title bar). The title bar is at about z = -1.27 and the generic pip is the leftmost pip. Its x is about `0.85 - 0.12 x (number of pips)` minus half a pip. These numbers are estimates from the existing badge positions and must be measured on a real card with the shot tool (mtg-tts/tools/tts-shot.ps1). Put the numbers in the same `BADGE` table as `BADGE.cost`.
- Size: big enough to cover the generic pip completely (it must hide the printed number), 1-2 characters, the same font and box colour as the `ctr` counters.
- Colours: the `ctr` counter box colour with white text, so it looks like the other counters. Direction is a thin rim only: `BADGE.less = green`, `BADGE.more = red` (a TTS button has no border, so the rim is a second, slightly larger button drawn under it in the rim colour).
- A tapped or rotated card: hand and command cards are never tapped. Not an issue.
- A card in the hand is drawn by TTS in a fan. Whether TTS draws a scripted button on a hand card at all is not proven here (fake TTS cannot say). Real-table check needed. Fallback if it does not: put the same information in the card name line shown on hover (`nickname(c)`/`description(c)`: "Costs {R}{R} now (printed {2}{R}{R})"). `description(c)` is already refreshed each board for hand cards (lines 491 and 213).

### Step 4: how it updates

- Every board carries the current `ec`. A change in a static effect (Thalia dies, a reducer enters) changes the next board, which changes the signature and redraws the one card. No timer.
- The cost can also change inside a turn without a visible board (a "this turn" effect that ends). It still arrives on the next board because the harness recomputes it for every snapshot.
- Cost of computing: the harness runs `CostAdjustment` for every hand card on every snapshot, for each seat. About 7-15 cards x 4 seats. Not measured. Check with the engine timing log before and after (it is one of the risks).

### Step 5: graveyard and exile (phase 2, needs an engine change)

- Cards you may cast from the graveyard or exile are the `playable` row (bridge.js `playableOf`, line 1393), built from zones passed with `castable = false`.
- A harness change is needed: compute the cost for the mode the card is actually castable in. A flashback card's first spell ability is its normal cast, so its effective cost would be wrong. Per mode, use the cast action's spell ability (`ActionSpace` knows it; the doc says `cast{... mode ...}`).
- Carry the cost on the action or on the card for the `mayPlay` ones only.
- This is an engine change: new `engine/manabrew.patch`, new node image tag (not `:exile`), one Docker build at a time. The coordinator deploys.
- Until then, graveyard/exile cards show no badge. State that in the hover.

## Cards and cases checklist

- Cards in hand: phase 1.
- Commander in the command zone: phase 1. Commander tax is part of `effectiveManaCost`.
- Commander cast from hand (after a bounce to hand): in hand, `effectiveManaCost` is computed the same way; tax applies if Forge applies it there. Check on the real board.
- Cast from graveyard/exile: phase 2.
- Goblin Electromancer ({1} less for instants and sorceries): generic drops by one. Badge shows the new generic sum.
- Emerald Medallion ({G} less for green spells): colour chip. Forge's reduction takes a coloured shard off only if the card has one; if the spell has none, the reduction is generic-only or nothing.
- Thalia (+{1} for noncreature spells): badge shows the increase.
- Sphere of Resistance (+{1} for all spells): same as Thalia.
- X spells: X stays out of the generic sum. A tax adds to the generic and shows. A reduction never touches X.
- Colored vs generic: both handled in Step 2.
- Split, adventure, MDFC: Forge's first spell ability only. Show the badge only for the first half. Say so in the hover ("first half").
- Face-down casts and lands: no badge (Forge returns null).
- Alternative costs (flashback, evoke, convoke, delve): the badge shows the normal cost only. Convoke and delve reductions happen at payment and are not in `effectiveManaCost`. State this in the hover.

## Tests

- bridge golden: a hand card with `ec`/`mc`, a command card with tax, a card with colour change, an X card. Re-record tests/golden/bridge_golden.json only after reading the diff (agent rules).
- tests/test_table_map.js: the changed entries and the new `check` line.
- A unit test of `engineCostChange` with the cases in Step 2 as a table, plus nasty inputs: empty strings, nil, hybrid, Phyrexian, `{X}{X}`, `{0}`, reversed order of pips.
- tests/test_table_claims.js: the badge sits at the position stored in `BADGE.cost`, does not overlap the `ctr` box (a rectangle test like the existing "extra-turn badge fit"), and a hand card gets exactly one cost button after two identical boards (no duplicates), zero when the cost returns to printed.
- tests/test_table_golden.js: table golden board with a badge (re-recorded after reading the diff).
- Fake TTS (tests/lua/tts-sim.lua) does not prove a button is drawn on a hand card. Real-table check required.
- Mutation run (agent rules): flip direction, drop the generic sum, swap green/red, skip the hand path, mis-parse hybrid, etc.
- Live: a debug game with Thalia and a hand of three kinds of spell; then Electromancer; then a commander cast twice.

## Risks

- Unverified: the field arriving on a real board (Step 0).
- The harness calls `CostAdjustment.adjust(..., false)` from snapshot extraction. The harness doc warns that these paths can reach choosers (convoke, delve, offering). It says the choosers are silent outside real payment, but the snapshot extractor does not set the "probing" flag. Test with a convoke card and a delve card in hand in debug mode. A freeze or a stray prompt would be a blocker and the field would have to be made safe in the harness.
- A cost reduced to nothing may be reported as an empty string. The code returns null for an empty result (`effective.isEmpty() ? null`). A card whose whole cost vanishes (a one-mana spell under a "1 less" effect) might then show no badge instead of a 0. Test this first; the fix is a harness change (return `{0}`), so it joins phase 2.
- Hand cards and TTS buttons: unproven. Fallback is the hover text.
- Collision with the age box and with picture variants whose cost row sits elsewhere (full-art, borderless, Showcase frames, split/adventure cards). Calibrate on the plain frame; accept an offset on others.
- Snapshot cost on the engine side: more CostAdjustment per board.
- Two truths: the badge could disagree with the payment prompt (a convoke/delve card, an effect the snapshot can't see). The text says "display only".

## Estimate

- Step 0 (prove the data, fixtures): 2 h.
- Bridge pass-through and table-map: 2-3 h.
- Cost-compare function and its table test: 3 h.
- Renderer: hand path, redraw rule, positions, colours, tooltip: 5-7 h.
- Real-table calibration (position per frame, hand button check, screenshots): 3-4 h.
- Other tests, mutation run, docs rows in docs/our-code-reference.md: 4-5 h.
- Phase 1 total: about 19-24 h (2 to 3 working days).
- Phase 2 (graveyard/exile, zero-cost fix, engine patch, image build, deploy): 8-12 h more.
- Risky parts are the hand-button question and the snapshot safety check. Do them first.
