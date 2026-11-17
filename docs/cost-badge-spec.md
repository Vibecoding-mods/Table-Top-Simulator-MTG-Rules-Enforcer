# Cost-change counter on cards (spec, item 13)

Status: written 2026-11-11. Phase 1 built the same day, in source only (bridge `costNow`, table `engineCostChange` / `engineCostParts`, self-check `map:cost`; tests in tests/test_bridge_claims.js "cost data" and tests/test_table_claims.js "cost compare" / "cost badge"). Not yet seen on the real table: Step 0 (the field on a real board), the hand-button question and the badge's place (`BADGE.cost` are estimates) are the live checks. Phase 2 built 2026-11-17 in a cloud session, engine and bridge/table, in source only (engine `engine1117-costbadge2`, no image; see Step 5). Source item: docs/next-features-2026-11-09.md, item 13.

Built differently from the plan below: there is nothing to fall back on for a hand card, whose hover text and badge stay as printed.

Correction from the live check of 2026-11-12 (bug C): `effectiveManaCost` does NOT contain the commander tax for a card in the command zone. CostAdjustment.java line 57 adds the tax only when `host.getCastFrom()` is the command zone, and GameAction sets castFrom only as the card moves to the stack, so a commander waiting in the command zone is priced untaxed. The first build added the tax only until any `effectiveManaCost` had come in the game, so Mairsil lost its badge once Thalia's hand costs arrived. `costNow` now adds `commanderTax` to the engine's command-zone cost (or the printed cost when none came), and takes the engine's cost as already taxed only when it has at least the tax's worth more generic than the printed cost. The statements below that the tax is part of `effectiveManaCost` are wrong for the command zone. The badge also shows on the playable row's cards and the revealed strip (both drawn from the same card data). The self-check's new line compares the cost buttons on hand and command cards with `engineCostParts`.

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

### Step 5: graveyard and exile (phase 2, built 2026-11-17)

The plan was the cast action's spell ability for the mode the card is castable in. Built as a field on the card, for
the `mayPlay` cards outside the hand only:

- **Engine (`engine1117-costbadge2`, docs/engine-changes.md):** `CardDto` gains `playCost`, `playCostMode` and
  `playCostPrinted` (all optional). The harness's new `PlayCost` sets them for a card its seat may play from a graveyard,
  exile or the library's top, from that seat's own view only:
  - a permission to cast (Kess, Dissident Mage; "you may cast from exile"): the card's own spell, mode `may play`;
    a free cast (`PayManaCost.NO`), `{0}` and mode `free`; an alternative mana cost the permission names, that cost;
  - otherwise the first alternative cost Forge offers from that zone (`GameActionUtil.getAlternativeCosts`): flashback,
    escape, disturb, harmonize and so on by their spell's zone restriction, foretold and plotted in exile. The mode is
    Forge's `AlternativeCost` name in lower case (`flashback`, `escape`, `foretold`, `plotted`);
  - a foretold card is face down: its face's spells and printed cost are read (`playCostPrinted`), since Forge's
    `manaCost` there is the face-down one's;
  - the cost has Forge's increases and reductions (below) and reads `{0}` when nothing is left.
- **Phase 1 finding, fixed with it:** `effectiveManaCost` never showed a reduction. `CostAdjustment.adjust(Cost, ...)`
  applies only `RaiseCost` statics and the commander tax; reductions, `SetCost` (Trinisphere) and the rest are in the
  `ManaCostBeingPaid` form. Both fields now take the raised cost through
  `CostAdjustment.adjust(ManaCostBeingPaid, sa, viewer, new CardCollection(), true, false)`. A spell whose reduction is a
  choice (assist, delve, convoke, improvise, waterbend, `TapCreaturesForMana`, offering, emerge) keeps the raised cost
  only: those paths call the controller's choosers, which could ask a question during a snapshot. Goblin Electromancer
  on a hand spell and Helm of Awakening taking Sol Ring to `{0}` now show (`CostBadgeTest`).
- **Bridge (`costNow`):** a card in the seat's playable row takes `playCost` as `ec`, against `playCostPrinted` or its
  printed cost as `mc`, with `em`, the way it is cast in words (`flashback`, `escape`, `foretell`, `plot`; none for a
  permission or a free cast), when the engine sent no `effectiveManaCost` and the two costs differ. The public
  graveyard and exile piles never carry it. A face-down card in the row (a foretold card) gets no badge fields, as
  before (its buttons might show to the other players); its hover text says "Costs {1}{U} now by foretell (printed
  {1}{U}{U})" instead (`cardNotes`).
- **Table:** `engineCostChange(mc, ec, em)` adds "by <way>" to the hover words ("Costs {2}{R} now by flashback (printed
  {R})"); `description` and the badge's tooltip pass `c.em`. The badge itself is phase 1's (the playable row was
  already a cost zone). No new XML.
- **Tests:** harness `CostBadgeTest` (14 checks), `tests/test_bridge_cost_badge_2.js` (23, in GATES); break-its
  `tools/mutate-cost-badge-2-engine.js` and `tools/mutate-cost-badge-2.js`.
- **Not done:** no image, no live game. Non-mana parts of a cost (escape's exiled cards) were not shown (done in
  phase 4).

#### Follow-ups (2026-11-17, `engine1117-costbadge3`, branch `cloud/followups-1`)

- **Split and adventure halves:**
  - A split card in hand has no badge. Phase 1 compared its first half with the whole card's cost and always showed
    it cheaper. The hover says each half whose cost changed ("Fire: costs {2}{R} now (printed {1}{R})"), from
    `spellCosts`.
  - An adventure card keeps its creature's badge, and the hover says the adventure ("Stomp: costs {2}{R} now (printed
    {1}{R})").
- **The cheapest way:** from a graveyard or exile, `playCost` is the cheapest of every way to cast the card there. The
  rest are in the hover: "Other ways to cast it: Ice {1}{U}; {2}{R} by flashback".
- **A half cast from there** (an aftermath half, a permission on a split card) has no badge, because the picture has a
  cost for each half and the badge sits on one. Its hover says "Castable: Memory {5}{U}{U} by aftermath (printed
  {4}{U}{U})".
- **Tests:** `CostBadgeTest` 22; `tests/test_bridge_cost_badge_3.js` (17, in GATES). Break-its
  `tools/mutate-cost-badge-2-engine.js` and `tools/mutate-cost-badge-3.js`. No Lua or XML change.

#### Phase 4 (2026-11-17, `engine1121-costbadge4`, branch `cloud/cost-badge-4`)

- **What a way costs besides mana** is in the hover, in Forge's words (`CostPart.toString()`), joined with ", ":
  - the way cast now (`playCostExtra`): "Escape also costs: exile eight other cards from your graveyard." A
    permission or a free cast reads "Casting it also costs: ...". Dread Return's flashback reads {0}; this line says
    its three sacrificed creatures.
  - each other way and each half (`SpellCostDto.extra`): "Other ways to cast it: {1}{R} by flashback, and pay 3 life";
    "Stomp: costs {2}{R} now (printed {1}{R}), and pay 2 life".
  - The badge itself is still mana only. The public graveyard pile says none of it, as before.
- **The tie-break for "cheapest":** mana value still decides. Life and cards aren't turned into mana: a player with
  40 life and one with 3 would weigh them differently, and the hover now says both. On equal mana value:
  1. the way with fewer non-mana parts wins (a plain cast beats a flashback that also takes 3 life);
  2. then the one that pays less life;
  3. then Forge's order, as before.
- **Tests:** `CostBadgeTest` 29 (7 new, including a unit check of `PlayCost.cheapest`);
  `tests/test_bridge_cost_badge_4.js` (12, in GATES). Break-its `tools/mutate-cost-badge-4-engine.js` (9 of 9) and
  `tools/mutate-cost-badge-4.js` (9 of 9). No Lua or XML change.
- **Not done:** a hand card's additional costs (kicker, a hand spell's sacrifice) aren't said: `effectiveManaCost` is
  mana only.

## Cards and cases checklist

- Cards in hand: phase 1.
- Commander in the command zone: phase 1. Commander tax is part of `effectiveManaCost`.
- Commander cast from hand (after a bounce to hand): in hand, `effectiveManaCost` is computed the same way; tax applies if Forge applies it there. Check on the real board.
- Cast from graveyard/exile: phase 2 (Step 5): flashback, escape, foretell, plot, a permission to cast.
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
- (Phase 2: a spell whose reduction is a choice keeps its raised cost only, so no chooser is reached; `CostBadgeTest` "assist". Step 5.) The harness calls `CostAdjustment.adjust(..., false)` from snapshot extraction. The harness doc warns that these paths can reach choosers (convoke, delve, offering). It says the choosers are silent outside real payment, but the snapshot extractor does not set the "probing" flag. Test with a convoke card and a delve card in hand in debug mode. A freeze or a stray prompt would be a blocker and the field would have to be made safe in the harness.
- (Fixed in phase 2: a cost reduced to nothing reads `{0}`, and reductions are applied at all; Step 5.) A cost reduced to nothing may be reported as an empty string. The code returns null for an empty result (`effective.isEmpty() ? null`). A card whose whole cost vanishes (a one-mana spell under a "1 less" effect) might then show no badge instead of a 0. Test this first; the fix is a harness change (return `{0}`), so it joins phase 2.
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
