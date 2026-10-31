# Forge script audit: `RememberChanged$ True` with no `ClearRemembered`

2026-10-30. Follows the Animist's Awakening bug (HAND-TEST-HP15.md, finding 3).

**Scope:** the 54 scripts from
`grep -l 'RememberChanged\$ True' .../cardsfolder/*/*.txt | xargs grep -L 'ClearRemembered'`, run before the Animist's
Awakening fix (53 now that it has its Cleanup).

**Result:** 28 fixed, 25 kept on purpose, plus Animist's Awakening (already fixed). Nothing is committed.

**A rebuild is needed for these fixes to take effect.** Card scripts are baked into `mtg-forge-node:exile`, at
`/build/forge/forge-gui/res/cardsfolder`. The current image (built 2026-10-30 11:18 UTC) has the Animist's Awakening fix
but not these 28. The images were not rebuilt or swapped for this audit. Rebuild when no game is on the table.

**Not run in the engine.** The verdicts come from reading the Java and the scripts, and the edits passed a static check
(see Verification). The image is a native build with no JVM to test against, and a live test would have meant touching the
stack. The riskiest fixes are the ones to hand-test after the rebuild; see the end of this file.

## How the engine behaves

These four facts decide every verdict below.

1. **Remembered survives zone changes.** `GameAction.changeZone` makes the new object with
   `new CardCopyService(c).copyCard(false)` (`GameAction.java:207`), and `copyCard` copies the list whenever the copy stays
   in the same game (`CardCopyService.java:65,84`). A spell's list therefore rides stack → graveyard → hand → stack. So
   Animist's Awakening was not caused by the manual fix that put it back in hand: `applyState`'s `move` uses the same
   `moveTo` (`ManaBrewInteractiveSession.java:2338`). Regrowth, flashback and buyback reach the same bug in normal play.
2. **A card that exiles itself leaves the list behind.** The moved card is copied first, then
   `hostCard.addRemembered(movedCard)` writes to the old object (`ChangeZoneEffect.java:809`). The new object starts
   clean. The list stays on the dead object, which only a second resolution from that same object can reach: a doubled or
   copied trigger, or a second activation held on the stack. That second resolution moves nothing, because the timestamp
   no longer matches (`ChangeZoneEffect.java:557`), so an "if you do" check reads only the stale list.
3. **A failed condition skips only that link, not what follows.** In `resolveApiAbility`, `sa.resolve()` sits inside
   `if (sa.metConditions())` and `resolveSubAbilities` sits outside it (`AbilityUtils.java:1392-1400`). A Cleanup chained
   under a conditional link therefore always runs, as long as the Cleanup carries no condition of its own. `UnlessCost` takes a
   separate path through `handleUnlessCost`, which also runs the sub-abilities when `UnlessResolveSubs` is absent
   (`AbilityUtils.java:1409-1411,1416-1419,1439-1441`). Puppet Master is the one fix that depends on this. No script here
   sets `UnlessResolveSubs`.
4. **Some effects keep or empty the list themselves.**
   - `ChooseCard` with `ForgetOtherRemembered` empties it, keeping nothing unless `RememberChosen` is set
     (`ChooseCardEffect.java:290-295`).
   - `TwoPiles` empties it at the end unless `KeepRemembered` is set (`TwoPilesEffect.java`, end of `resolve`).
   - `Clone` empties it on the clone target (`CloneEffect.java:163,195`).
   - `DelayedTrigger` and `Effect` copy it into their own object when they resolve, so clearing the host afterwards is
     safe (`DelayedTriggerEffect.java`, `EffectEffect.java:83,238`).
   - A delayed trigger's `Defined$ Remembered` still reads the **host's** list when it fires. `DelayTriggerRememberedLKI`
     reads the trigger's own copy.

## Fixed (28)

Every fix adds `SubAbility$ DBCleanup` to the last link of the chain, plus
`SVar:DBCleanup:DB$ Cleanup | ClearRemembered$ True`. "Reach" says how a game gets there. Thieves' Auction also needed a
changed loop condition; see its own section.

### Thieves' Auction: the loop could never end

If a commander's owner sent it to the command zone instead of exile, `ChangeZoneAll` still remembered it
(`ChangeZoneAllEffect.java:168-172`). `DBChoose` only offers cards in exile, so `ForgetChosen` could never remove it, while
`RepeatPresent$ Card` still counted it in any zone. The Repeat has no `MaxRepeat` (`RepeatEffect.java`), so the engine
would loop forever without a prompt. On this table that is a freeze with commanders in play.

| Change | Why |
|---|---|
| `RepeatPresent$ Card` → `Card.inRealZoneExile` on `DBRepeatChoose` | The loop now asks the same question as the choice: is a remembered card still in exile? It is fixed here and not at `RememberChanged` because `ChangeZoneAll` adds merged cards with no filter (lines 182-189), so filtering what gets remembered could still leave one the loop can't finish |
| `SubAbility$ DBCleanup` on `DBRepeatChoose`, outside the loop | The commander now stays listed after the loop ends, so the list needs clearing like the others |

`inRealZone` is used instead of `inZone` because `inZone` reads last-known info. It would give the same answer here, since
the exiled copy has a new timestamp and misses the LKI table (`GameAction.java:370`, `Game.java:291`), but `inRealZone`
does not depend on that.

The seven other scripts whose Repeat tests `RepeatDefined$ Remembered` do not have this hang (Countryside Crusher,
Cultivator Colossus, Demonlord Belzenlok, Primal Surge, Revealing Wind, Sin, Spira's Punishment, Tyrant of Discord): each
resets the list on every pass, so the loop tests a new result rather than a fixed list.

### Stale cards in ordinary play

| Card | Cleanup chained from | What the stale list did | Reach |
|---|---|---|---|
| Forgefire Automaton | `DBAnimate` | Each upkeep's perpetual power change also hit every creature returned on earlier upkeeps | Every upkeep it stays on the battlefield |
| Kaya, Geist Hunter | `DBToken` | `Remembered$Amount` counted the first ultimate's cards, so a second ultimate made too many Spirits | Reaching −6 twice (proliferate, Doubling Season) |
| Sunfall | `DBIncubate` | `Remembered$Amount` counted earlier casts, so Incubate came out too big | Any recast from the graveyard |
| Immortal Obligation | `DBEffect` | The new Effect also tracked creatures from earlier casts | Any recast |
| Dubious Challenge | `YouGetTheRest` | Earlier cards still or again in exile could be picked and returned | Any recast |
| Mnemonic Betrayal | `ExileSelf` | The list rides to exile with the spell, so a recast from exile also granted the earlier cards | Casting it again from exile |
| Shoreline Scout | `DBConjure` | Its `EQ1` check read the old card: decline and it conjured anyway, exile again and the count was 2, so it did not | Blink, or any re-entry |
| Puppet Master | `DBChangeZone` | `adjustAuraHost` moves the host to the graveyard, so the list rode back to hand and passed the "returned this way" check next time | Each time it returns to hand. The chain runs through `UnlessCost` (fact 3) |

### Wrong result only on a doubled trigger or copied ability

Here the list sits on the dead object (fact 2), so a second resolution is the only way to reach it. Panharmonicon, Strionic
Resonator and Rings of Brighthearth are typical sources.

| Card | Cleanup chained from | What the stale list did |
|---|---|---|
| Archfiend's Vessel | `DBToken` (conditional) | The second trigger exiled nothing but still made a second 5/5 Demon |
| Mazemind Tome | `DBGainLife` (conditional) | A copied trigger gained another 4 life |
| Inscribed Tablet | `DBDraw` (conditional) | A copied ability that found no land skipped its draw because of the first copy's land |
| Jeskai Infiltrator | `DBManifest` | The second trigger's Manifest also saw the first one's cards |
| Primeval Spawn | `DBPlay` | The second trigger could also cast the first one's cards, on a fresh 10 mana value budget |

### Harmless so far: the stale list had no visible effect

Each list is used in a single resolution, so these meet the audit's definition of the leak, but a stale read does nothing
you would see today. A Cleanup costs nothing here, and it makes "if you do" true to the card.

| Card | Cleanup chained from | Why it was harmless |
|---|---|---|
| Aetherling, Anurid Brushhopper, Djinn of the Fountain, Fleeting Spirit, Ghost Council of Orzhova, Hikari, Twilight Guardian, Meandering Towershell, Nezahal, Primal Tide, Norin the Wary | `DelTrig` (conditional) | A second activation or trigger passed the `ConditionPresent` check on the stale card and made a second delayed trigger. That trigger then found the card gone from exile |
| Argent Sphinx, Saltskitter | `DelTrig` / `DBDelTrig` | Same, with no condition on the delayed trigger |
| Conqueror's Galleon | `DBReturn` | A doubled attack trigger's `Origin$ Exile` found nothing to return |
| Lukamina, Moon Druid | `DBReturn` on all five specialized faces (each has its own SVars) | A doubled dies trigger's `Origin$ Graveyard` found nothing to return |
| Primal Surge | The root `SP$ Repeat`, not the loop | `ForgetOtherRemembered` clears it each pass, but the last card stays listed. Only a recast with an empty library skips that clear. The Cleanup must stay outside `DBDig`/`DBChangeZone`, because `RepeatDefined$ Remembered` reads the list between passes |

The delayed-trigger Cleanups are safe because `RememberObjects` already copied the list and each `TrigReturn` uses
`DelayTriggerRememberedLKI`. The same pattern exists upstream (`abuelo_ancestral_echo.txt:8`).

## Kept on purpose (25)

### Linked abilities: the list is read later (7)

| Card | What reads it |
|---|---|
| Endless Horizons | The upkeep trigger, `Card.IsRemembered+YouOwn` |
| Fiend Hunter | The leaves-the-battlefield trigger, `DirectRemembered`. `ForgetOtherRemembered` also resets it on each new exile |
| Gelatinous Cube | Dissolve, `Creature.IsRemembered+ExiledWithSource` |
| Hoarding Dragon | The dies trigger, `Defined$ Remembered` |
| Idol of Endurance | The `AB$ Effect`, `RememberObjects$ Remembered` |
| My Undead Horde Awakens | The abandon trigger, `Creature.IsRemembered` |
| Search the City | The cast and land triggers, `sharesNameWith Remembered`, `Remembered$Amount` |

### A delayed trigger reads it a turn later (3)

| Card | Why a Cleanup would break it |
|---|---|
| Obzedat, Ghost Council | `ObzedatPump` uses `Defined$ Remembered` when the delayed trigger fires at upkeep (fact 4). Clearing the list after `DelTrig` would silently remove the haste |
| Sundering Sentinel | Same, `DBPump` |
| Teysa of the Ghost Council | Same, `ObzedatPump` |

### The list lives on a throwaway Effect (1)

| Card | Why |
|---|---|
| Feather, the Redeemed | `ReplaceExile` runs with the Effect as host, and each trigger makes a new Effect. That list is also what `ValidCard$ Card.IsRemembered` and `ExileOnMoved$ Stack` match on |

### Already emptied in the same resolution (8)

| Card | What empties it |
|---|---|
| Brilliant Ultimatum | `TwoPiles` with no `KeepRemembered` |
| Hostile Negotiations | `TheyChoose` (`TwoPiles` with no `KeepRemembered`). `YouChoose` keeps it on purpose. The existing `DBCleanup` only needs `ClearImprinted` |
| Chandra, Flameshaper | `DBChoose`, `ForgetOtherRemembered` |
| Feldon, Ronom Excavator | `DBChoose`, `ForgetOtherRemembered` |
| Strongbox Raider | `DBChoose`, `ForgetOtherRemembered` |
| Deadeye Navigator | `ForgetOtherRemembered` on the ChangeZone itself, unconditional (`ChangeZoneEffect.java:517`) |
| Discover the Impossible | `ForgetPlayed` on the cast, `ForgetChanged` on the move to hand: one of the two always runs on the card |
| Scion of the Ur-Dragon | `Clone` clears the host's list (`CloneEffect.java:163,195`) |

### Nothing reads the list (6)

`RememberChanged` here is a leftover: no ability, static or SVar in the script reads the host's list, so a stale list can do
nothing. A Cleanup would change no behaviour.

| Card | Note |
|---|---|
| Ashiok, Nightmare Weaver | Its −X ability uses `ExiledWithSource`, and its `Card.IsRemembered` is on the static effect's own list |
| Ian Malcolm, Chaotician | The static uses `ExiledWithSource` |
| Lat Nam's Legacy | See Other findings |
| Path to the Festival | The scry condition counts basic land types |
| The Princess Takes Flight | Chapter III uses `Defined$ ExiledWith` |
| Worzel the Protector | No reader |

## Other findings (not changed)

These fall outside this audit's definition of the leak. All come from reading the code; none has been seen live.

1. **Lat Nam's Legacy ignores "if you do."** `DelTrigSlowtrip` has no condition, so casting it with an empty hand still
   draws two cards.
2. **Linked lists also ride zone changes (fact 1).** A reanimated Hoarding Dragon keeps its old list, so if the first
   exiled card is still there, its death offers that card too. Endless Horizons has the same shape if it re-enters. Fiend
   Hunter is protected by `ForgetOtherRemembered` and Gelatinous Cube by `ExiledWithSource`. These lists persist on purpose,
   so they were left alone, but the correct behaviour would tie them to the new object.
3. **The grep's reach is limited.** It skips any file with a `ClearRemembered` anywhere, even on a path the leaking ability
   never reaches, and it matches only `RememberChanged$ True`. The engine accepts any value for this parameter on `Dig`
   and `SetState`.

## Verification

- A separate script re-parsed all 28 files by card face and walked every `SubAbility$` chain from each `RememberChanged`:
  every chain ends in an unconditional `ClearRemembered` Cleanup, every chained SVar exists in the same face, and Primal
  Surge's Cleanup is outside its loop. Its one failure is the intended Thieves' Auction `RepeatPresent` change, which its
  chain-only diff rule does not allow for; that diff was read by hand and is the three intended lines.
- Each file was diffed against its backup: apart from that `RepeatPresent` change, the only changes are the chain addition
  and the new SVar line. Line endings are unchanged (LF).
- `git status` in `manabrew/forge` shows 29 changed scripts: these 28 and Animist's Awakening. 66 insertions and 33
  deletions, as expected for 33 edited chain lines and 33 new SVar lines. No kept card changed.
- Not verified: a load of these scripts in Forge, or play on the table.

Hand-test first after the rebuild: Thieves' Auction with a commander sent to the command zone (the game must carry on, and
every exiled card must still get chosen), Puppet Master (the `UnlessCost` path, both paying and declining), Obzedat (still
gets haste, unchanged but it is why three cards were kept), Forgefire Automaton across two upkeeps, and Primal Surge (the
loop still repeats).

## Files

- Originals: `tmp/remembered-audit-orig/<card>.txt.orig`. Animist's Awakening: `tmp/animists_awakening.txt.orig`.
- `manabrew/AGENTS.md` says to treat the `forge/` submodule as read-only, and these edits are in it, as you asked. They sit
  in the submodule's working tree, so a `git submodule update` could discard them.

## Played on the rebuilt engine (2026-10-30)

`node bridge/rules-check.js --game audit` (headless, no TTS) cast and activated every fixed card on an engine built from `engine/`,
counting what truly reached the stack, not what was attempted. With audited cards returned to hand by manual fix:
**all 25 cards in the deck reached the stack at least twice, with no engine errors or rejected answers.** Immortal Obligation
needed a creature moved to the AI's graveyard (`RC_BOT=ai_gap_creatures`). Puppet Master, Obzedat, Forgefire Automaton and
Primal Surge were played through the table (docs/HAND-TEST-HP24.md).

This shows the scripts load, run, repeat and don't crash. It doesn't check each card's outcome: a fix whose only effect shows
on a doubled trigger (Panharmonicon) wasn't exercised, since no doubling was in the deck.

Thieves' Auction with a commander: played twice with Kenrith out. Kenrith went into exile and stayed pickable; the
command-zone choice only comes afterwards, as a state-based choice. So the "loop could never end" path above wasn't reached in play
and doesn't look reachable through this card; the fix stays as cheap insurance.
