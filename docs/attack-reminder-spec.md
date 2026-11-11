# Attack reminders: spec

Asked 2026-11-10: "If there's a pay to attack or multiple creatures can't attack, a prompt should pop up to remind
players." Tracked as item 23 in `docs/next-features-2026-11-09.md`.

Status 2026-11-11: part 1 and part 2 are built in the bridge (source only, not deployed). Part 2 reads every rule
from the cards' text on the board, so nothing new from the harness was needed. Part 3 (engine) is not built: it is
still needed for effects that leave no text on the board (War Tax, Forbidding Spirit's trigger, Sivitri's +1,
emblems, keywords from spells that have resolved), for Forge's exact reasons and costs, and for Dain's condition.
Line numbers below are from the source on 2026-11-10.

Short names used below:

- **harness** = `manabrew/forge-harness/src/main/java/forge/harness/`
- **Forge** = `manabrew/forge/forge-game/src/main/java/forge/game/` (upstream, read only)
- **bridge** = `bridge/bridge.js`
- **table** = `tools/engine-renderer.lua`

## 1. The problem, seen live

On 2026-11-10 at about 11:48 (the user against a friend, packaged build), White had Crawlspace and Norn's Annex
out. Blue pressed "All attack" with 3 creatures, 8 times in a row. Each time Forge refused it, and each time the
bridge told Blue:

> That attack isn't legal. Something on the table limits who can attack, or who they can attack.

Crawlspace allows only two attackers at White. Nothing said so. Blue finally attacked with one creature and got
"Pay {W/P} for Mother of Runes" (Norn's Annex's tax). Nothing said why that cost was asked either. The players
thought it was a glitch. Evidence: the packaged build's `logs/table-log.log` lines 190-216 and `logs/bridge.log`
lines 244-270 (prompts #224-#249).

## 2. How it works today

### 2.1 The attack question

1. Forge's turn step calls the controller's `declareAttackers`, then checks the answer
   (Forge `phase/PhaseHandler.java:537-600`).
2. The harness controller lists legal attackers: every creature that can attack at least one defender
   (harness `host/ManaBrewInteractiveController.java:425-446`, which calls
   `common/CombatChoiceSpace.java:16-28`). The test is `CombatUtil.canAttack(card, defender)`.
3. The session builds the prompt (harness `host/ManaBrewInteractiveSession.java:3203-3231`). Each attacker gets
   `validTargetIds` (the defenders it can attack, from `CombatChoiceSpace.legalDefendersForAttacker`, lines 30-38),
   with Forge's best attack target first. `mustAttack` is set for goaded creatures and "attacks each combat if
   able" (`StaticAbilityMustAttack`). `attackTargets` lists every defender with a name and kind.
4. The prompt has no other fields. Its Rust type is `ChooseAttackersInput { attackers, attackTargets }`
   (`manabrew/manabrew-rs/crates/manabrew-protocol/src/prompts/choose_attackers.rs`). Compare `ChooseBlockersInput`,
   which has an `error` field for a refused declaration (`choose_blockers.rs`).
5. The answer comes back as `{attackerId, targetId}` pairs (`ManabrewProtocolAdapter.java:79` renames `targetId` to
   `defenderId`). The controller adds each pair only if `CombatUtil.canAttack(card, defender)` still holds
   (`ManaBrewInteractiveController.java:440-441`). A pair that fails is dropped without a word.

The bridge words it (bridge `onPrompt`, `case "chooseAttackers"`, lines 6183-6207):

- Title "Choose attackers". One option per attacker and target ("Grizzly Bears → White"), plus "All attack" and
  "No attacks".
- "All attack" sends every offered creature at its first target. "No attacks" sends none. Creatures that must attack
  are always added (lines 6193-6198).
- `ui.text` is "Must attack: ..." when some must. Nothing else is said.

The table shows it:

- The corner hint is the title plus "Click a creature, then who it attacks. Or All attack / No attacks."
  (table line 2772), then the bridge's `note` if any, cut to 140 characters (line 2781).
- The engine panel shows `ui.text` in full (table line 2914).
- Corner buttons: "No attacks" / "All attack" before any pick, then "Attack (n)" / "No attacks" (lines 2829-2851).
- Attack lines go from each attacker to its target (lines 1263, 1382).
- Q/E on a creature that isn't offered says only "That creature can't attack right now." (line 4353).

### 2.2 Creatures that can't attack

Forge's test is `CombatUtil.canAttack(attacker, defender)` (Forge `combat/CombatUtil.java:199-240`). In order:

- Not a creature, tapped, phased out, or summoning sick (`isAttackerSick`, line 242, which is
  `StaticAbilityCantAttackBlock.canAttackHaste`, Forge `staticability/StaticAbilityCantAttackBlock.java:366-382`).
- Goad: a goaded creature can't attack a player who goaded it while another player can be attacked (lines 218-232).
- `StaticAbilityCantAttackBlock.cantAttack` (lines 37-60): the keywords "CARDNAME can't attack." and
  "CARDNAME can't attack or block.", detain (`isDetained`), and every `Mode$ CantAttack` static ability.
  Pacifism, Arrest and Moat are such statics. So is defender: Forge turns the keyword into
  `Mode$ CantAttack | ValidCard$ Card.Self` (Forge `card/CardFactoryUtil.java:3874-3876`).

Forge returns only true or false. **No reason comes back.** But each piece can be asked on its own: `isTapped`,
`isPhasedOut`, `isAttackerSick`, `isGoaded`/`isGoadedBy`, `isDetained`, and `applyCantAttackAbility(stAb, card,
defender)` (public, lines 69-124), whose `stAb.getHostCard()` names the card that forbids it.

Today the harness simply leaves such creatures out of `attackers` (`CombatChoiceSpace.legalAttackers`). The bridge
never learns they exist as far as the question goes. What the table shows elsewhere:

- The card's status box says "Summoning sick" on its controller's turn (bridge `tableCard`, line 1252). The board
  sends `summoningSick` = Forge's `hasSickness()` (harness `host/InteractiveSnapshotExtractor.java:814`).
- Goad is tracked and shown ("Goaded by White", bridge line 1248).
- Detain is only a game-log line (bridge line 2647). There is no detained state the bridge keeps.
- Nothing lists Pacifism, defender or Moat as the reason a creature is missing from the question.

### 2.3 Attack taxes (Propaganda and friends)

All of these are `Mode$ CantAttackUnless | Cost$ ...` statics. The scripts, from
`manabrew/forge/forge-gui/res/cardsfolder/`:

| Card | Who it covers | Cost |
|---|---|---|
| Propaganda, Ghostly Prison, Windborn Muse | `Target$ You` | `2` |
| Sphere of Safety | you and your planeswalkers | `X` = enchantments you control |
| Norn's Annex | you and your planeswalkers | `WP` ({W/P}) |
| Baird, Steward of Argive | you and your planeswalkers | `1` |
| Collective Restraint | you | `X` = domain |

Forge computes the cost in `CombatUtil.getAttackCost` (Forge `combat/CombatUtil.java:288-306`). It adds up every
static's cost for one attacker and one defender (`StaticAbility.getAttackCost`, Forge `StaticAbility.java:306-314`,
then `StaticAbilityCantAttackBlock.getAttackCost`, lines 301-335). So Ghostly Prison plus Norn's Annex is one
payment of both.

When Forge asks (Forge `PhaseHandler.java:556-599`):

1. Only after the declaration passed `validateAttackers`.
2. First every non-vigilance attacker is tapped (lines 557-564). So an attacking mana creature can't pay a tax.
3. Exert and enlist are asked next (lines 567-577).
4. Then **one payment per attacker**, in declaration order (`checkPropagandaEffects`, CombatUtil lines 254-270).
   Forge's own prompt text is "Pay additional cost to declare X an attacker".
5. If a payment is not made, that attacker is removed and untapped (lines 583-587). The rest stay. If the attack is
   then illegal (a must-attack rule), all attackers untap and the whole question is asked again (lines 588-597).
6. Payments already made for earlier attackers are not refunded (Forge's own TODO, line 580).

What reaches the player:

- The harness's `payCombatCost` ignores Forge's prompt text and pays through the ordinary cost path
  (`ManaBrewInteractiveController.java:1881-1883`, `HarnessCostPlumbing.payWithControllerDecision`).
- The mana part becomes a normal `payManaCost` prompt for the attacker card (`payManaInteractively`, controller
  lines 2021-2063; `publishManaPaymentPrompt`, session lines 832-839). Cancel is allowed unless the pool already
  covers the cost (controller lines 2037-2042).
- The bridge words it "Pay {2} for Grizzly Bears" with Auto-pay, the taps, and Cancel (bridge lines 5295-5303).
  Seen live: "Pay {W/P} for Mother of Runes": Auto-pay | Pay 2 life | Cancel.
- Nothing names the card that asks, nothing says it is an attack tax, and nothing says Cancel leaves that creature
  out of the attack.
- **Nothing shows the cost before the declaration.** The harness never calls `getAttackCost` for the prompt.

### 2.4 Attack limits and "alone" rules

- Silent Arbiter, Dueling Grounds, Caverns of Despair: `Mode$ AttackRestrict | MaxAttackers$ N` (no defender).
- Crawlspace, Judoon Enforcers: the same with `ValidDefender$ You`. The Eternal Wanderer and Tomik cover
  planeswalkers.
- Forge reads them as numbers only: `StaticAbilityAttackRestrict.globalAttackRestrict` and `attackRestrictNum`
  (Forge `staticability/StaticAbilityAttackRestrict.java:11-48`). The card's name is not kept.
- `GlobalAttackRestrictions` (Forge `combat/GlobalAttackRestrictions.java`) holds the overall maximum and one per
  defender. When every defender has a maximum, the overall maximum is their sum (lines 70-73). That is why, in the
  live two-player game, Crawlspace made 2 the limit for the whole attack.
- "Can't attack alone", "can only attack alone", "can't attack unless a black or green creature also attacks" and
  similar are keyword restrictions on the creature (Forge `combat/AttackRestriction.java:80-100`).
- The check is `CombatUtil.validateAttackers` (lines 83-91), which uses `AttackConstraints.countViolations`
  (Forge `combat/AttackConstraints.java:376-404`): -1 for a broken limit or restriction, otherwise how many
  must-attack rules were broken. The attack must break no more of them than Forge's best legal attack.

An illegal declaration:

1. Forge sends `notifyOfValue(null, null, "Attack declaration invalid")` and asks again (PhaseHandler lines 550-553).
   It gives no reason. Native Forge's own screen gives none either.
2. The harness turns the notice into a `revealCards` prompt with no cards and that title
   (`ManaBrewInteractiveController.java:2569-2576`, `ManaBrewInteractiveSession.java:1234-1238`).
3. The bridge answers it by itself and sends one chat line (bridge lines 6301-6306). With must-attack creatures it
   lists them. Otherwise it is the generic line from section 1.
4. The question comes back the same as before. "All attack" is still the big button, and sends the same illegal
   attack again.

### 2.5 Maze of Ith

Maze of Ith is not a can't-attack effect. It untaps an attacking creature and prevents its damage, after attackers
are declared. It is out of scope here (see open question 7).

## 3. What the player should see

Three parts, cheapest first. Each part works on its own.

### Part 1: say why an attack was refused (bridge only)

When Forge refuses an attack, the player is told which card limits it and what the limit is. Examples:

- "Crawlspace (White): no more than 2 creatures can attack White each combat. You chose 3."
- "Silent Arbiter (Red): no more than 1 creature can attack each combat. You chose 4."
- "Mogg Flunkies can't attack alone."
- "Must attack: Goblin Guide. Any you don't choose are sent for you." (as today)
- When the bridge finds nothing it can name: today's generic line, plus a list of every permanent on the table whose
  text limits attacks, if any.

Where: the same chat line as today, and the same words in the `note` and `text` of the next "Choose attackers"
question. Then it stays in the corner hint and the engine panel until the player answers. Chat alone is easy to
miss.

Also: while a known limit applies, "All attack" should not send an attack the bridge already knows is illegal. The
bridge keeps the question open and says the limit instead, without a round trip to Forge. (Which creatures to keep
is the player's choice. See open question 3.)

### Part 2: remind before the attack (bridge first, harness later)

On the "Choose attackers" question, before any pick:

- **Taxes, per defender.** "Propaganda (White): each creature attacking White costs {2}. You have 5 mana open."
  Two taxes on one player add up: "Ghostly Prison + Norn's Annex (White): {2}{W/P} per creature attacking White or
  their planeswalkers." Sphere of Safety shows its X worked out.
- **Limits.** "Crawlspace (White): at most 2 creatures can attack White."
- **Can't attack.** "Can't attack: Grizzly Bears (summoning sick), Wall of Omens (defender), Serra Angel (Pacifism)."
  Tokens of one kind are grouped: "3 Goblin tokens (summoning sick)". Tapped creatures are left out; that one is
  plain to see.
- **Can't attack one player.** "Can't attack Red: Goblin Guide (goaded by Red)."
- A short line about the order: "Attackers tap before you pay, so an attacking mana creature can't help pay."

Nothing is shown when none of these apply. Most combats show nothing new.

On the tax payment itself, the title names the tax: "Propaganda (White): pay {2} to attack with Grizzly Bears?"
and Cancel reads "Don't attack with Grizzly Bears".

Q/E on a creature that isn't offered gives its reason: "Grizzly Bears can't attack: Pacifism." instead of
"That creature can't attack right now."

### Part 3: exact data from the engine (harness)

Part 2's first version reads rules text and board flags. It will miss cards whose wording differs, and effects that
leave no text on the board (an emblem, a keyword granted by a spell that has resolved). Part 3 has the harness send
Forge's own answers. The bridge then uses them first and falls back to the text reading only when they are missing.

## 4. Where it shows

No new pop-up window. The table already has three places, and each is used for what it does best:

- **Corner hint** (table line 2772-2781): the question's title, one line on how to answer, and the bridge's `note`,
  cut to 140 characters. Use it for the one most important line: the refusal (part 1), or "Taxed: White {2} each"
  (part 2).
- **Engine panel** (`ui.text`, table line 2914): the full list. Taxes, limits, can't-attack list.
- **Chat** (bridge `chat`): the refusal only, as today, so it is in the scrollback.

If the user wants a real pop-up that must be dismissed, the bridge can send an "OK" question (a `single` prompt
with one option) before "Choose attackers", only when a tax or limit applies. See open question 2.

**The table's main chunk is at 179 of MoonSharp's 200 locals.** Parts 1 and 2 need no new table code: `note` and
`text` already show. The one table change (the Q/E reason) goes inside the existing `kind == "attack"` branch of
the Q/E handler (table lines 4344-4354), reading a new field of the prompt (`p.cantAttack[id]`). No new main-chunk
`local`. If a helper is needed, it goes inside an existing `do ... end` block or function. The bridge sends extra
`ui` fields to the table already (`dest`, `scry`, `copies`).

## 5. What each layer needs

### Part 1: bridge only

- In `case "chooseAttackers"`, keep the last answer on the seat: `seat.lastAttack = [{attackerId, targetId}]`.
  The `toOutput` at lines 6193-6198 builds it already.
- A new helper, `attackRules(gv, byId)`, reads every battlefield card's `text` (Forge's oracle text,
  `InteractiveSnapshotExtractor.java:801`) and returns rules like
  `{ card, controller, kind: "max" | "maxAt" | "tax" | "cant" | "alone" | "onlyAlone", n, cost, who }`.
  It works from wording, not a card list:
  - `No more than (one|two|\d+) creatures? can attack( you)?( each combat)?` gives `max` (no "you") or `maxAt`
    (the card's controller; "this planeswalker" or the card's own name means that planeswalker).
  - `can't attack (you|planeswalkers you control|you or planeswalkers you control)? ?(or block )?unless (its|their)
    controller (pays|sacrifices) ...` gives `tax`, with the cost words after "pays". On the creature's own text, or an
    aura's "Enchanted creature can't attack ... unless", it is a tax on that creature only (Brainwash, Qal Sisma
    Behemoth). `{X}` is worked out only for wording the bridge can count (Sphere: "the number of enchantments you
    control"). Otherwise it is shown as `{X}` with the card's own "where X is ..." words.
  - The 31 `CantAttackUnless` cards in Forge's cardsfolder word it many ways: mana, life (Sivitri), sacrificing lands
    (Reclamation, Flooded Woodlands), returning an enchantment (Floodtide Serpent), tapping a creature (Hollow
    Warrior). Some only apply for a while and leave no text on the board once their spell or ability has resolved
    (Forbidding Spirit's enter trigger, War Tax, Sivitri's +1, Summon Yojimbo's chapters), and some have a
    condition (Archangel of Tithes: only while untapped, which the board shows; Dain, Lord of the Iron Hills: only
    with an enduring story, which it doesn't). Text reading can't cover all of those. That
    is the case for part 3.
  - `(\w+ )?creatures can't attack you` with no "unless" (Blazing Archon, Elephant Grass) gives `cant` at that
    defender.
  - `can't attack( or block)? alone` and `can only attack alone`, on the creature's own text, give `alone` and
    `onlyAlone`.
  - `Creatures without flying can't attack` (Moat) and the like give `cant` with a test on the creature.
- In `case "revealCards"`, at the "Attack declaration invalid" branch (lines 6301-6306): count the last attack per
  defender and overall, check it against the rules, and name what it broke. Keep it for the next "Choose attackers"
  as `note` and `text`. Clear it once that question is answered.
- "All attack" (lines 6188 and 6196): when a known `max` or `maxAt` would be broken, don't send. Say the limit and
  keep the question open.
- Unit tests next to the existing refusal cases in `tests/golden/bridge-cases.js` (lines 351-357): Crawlspace with
  3 attackers at its controller, Silent Arbiter with 4 attackers spread over 3 players, Mogg Flunkies alone, a
  must-attack creature, and a board with no rule the bridge can name.

### Part 2, first version: bridge only

- The same `attackRules` helper.
- Taxes per defender: every `tax` rule whose controller is a defender in `attackTargets`, summed per defender.
  "Or planeswalkers you control" also covers that player's planeswalker targets.
- Mana open: the seat's pool plus its untapped mana sources, from the board. It is a guide only ("about 5 mana
  open"). It doesn't know which attackers will tap.
- The can't-attack list: the seat's creatures on the battlefield that are not in `input.attackers`. Reasons, in
  Forge's order: tapped (left out), phased out, `summoningSick` (and no haste in `keywords`), detained (the bridge
  has to start remembering detain targets the way it remembers goad, bridge line 2636), "Defender" in `keywords`,
  an attached card whose text says "Enchanted creature can't attack", a `cant` rule that matches it, else "an
  effect on the table".
- A creature that is offered but not at every defender: compare its `validTargetIds` with `attackTargets`. Name goad
  when the bridge's goad map has it. Otherwise "can't attack Red".
- The tax payment: in `case "payManaCost"` (lines 5228-5321), when the step is `combatDeclareAttackers`, the paid-for
  card is the seat's own attacking creature, and a `tax` rule covers its target, name the rule in the title and
  relabel Cancel.
- A `cantAttack` map (`{ [cardId]: reason }`) on the `ui` of the attack question, for the table's Q/E reply.

### Part 2 table change: Lua only

- Q/E on a creature not offered: `tell(color, name .. " can't attack: " .. reason)` from `p.cantAttack`, inside the
  existing branch at table lines 4344-4354. No new main-chunk local.
- Rebuild the save with `node tools/make-engine-copy.js` and push or deploy with TTS closed or no game running.

### Part 3: harness (Java) change, protocol change, node image rebuild

- **Protocol** (`manabrew-protocol/src/prompts/choose_attackers.rs`), all optional with
  `#[serde(default, skip_serializing_if = ...)]`, as `ChooseBlockersInput.error` does:
  - `AttackerOptionDto.costs: Vec<{ defenderId, cost, sources: Vec<String> }>`: the attack tax for this creature at
    each defender it can attack.
  - `ChooseAttackersInput.unavailable: Vec<{ cardId, reason, sourceId? }>`: creatures that can't attack at all.
  - `AttackerOptionDto.blockedTargets: Vec<{ defenderId, reason, sourceId? }>`: defenders this creature can't attack.
  - `ChooseAttackersInput.limits: Vec<{ max, defenderId?, sourceId }>`: Silent Arbiter, Crawlspace.
  - `ChooseAttackersInput.error: Option<String>`: why the last declaration was refused.
  - Then `yarn gen:types`, and the harness build regenerates the Java prompt classes (`scripts/harness.mjs`, see
    the harness `AGENTS.md`, "Typed prompt emission").
- **Harness** (`host/ManaBrewInteractiveSession.publishAttackersPrompt`, lines 3203-3231, and a helper in
  `common/CombatChoiceSpace`):
  - Taxes: loop `game.getCardsIn(ZoneType.STATIC_ABILITIES_SOURCE_ZONES)` and their statics, call
    `stAb.getAttackCost(attacker, defender, List.of())`, and keep the host card's id per non-null cost. This mirrors
    `CombatUtil.getAttackCost` (lines 288-306) and keeps the source names. The total is
    `CombatUtil.getAttackCost(game, attacker, defender)`. Note: a static with `RememberingAttacker` adds the attacker
    to its host's remembered list for the call and removes it after (StaticAbilityCantAttackBlock lines 313-325).
    That is what Forge itself does on every call, so it is safe, but see the memory note "Forge Remembered carries
    across zones".
  - Can't attack: for each creature the player controls that `legalAttackers` left out, and for each defender a
    legal attacker can't attack, ask the parts of `canAttack` in Forge's order (section 2.2). For statics, loop them
    as `StaticAbilityCantAttackBlock.cantAttack` does (lines 48-58) and name the first host card for which
    `applyCantAttackAbility` is true. Reasons are short fixed words: `tapped`, `phasedOut`, `summoningSick`, `goaded`,
    `detained`, `defender` (the static is `isKeyword(Keyword.DEFENDER)`), `keyword` (the "CARDNAME can't attack."
    keyword, source unknown), `static` (with `sourceId`).
  - Limits: loop the statics as `StaticAbilityAttackRestrict` does (lines 11-48) and keep each host card with its
    `MaxAttackers` and defender.
  - Refusal: in `ManaBrewInteractiveController.declareAttackers` (lines 425-446), check
    `CombatUtil.validateAttackers(combat)` before returning. When it fails, work out why (the global and per-defender
    maximums from `getAttackConstraints().getGlobalRestrictions()`, each attacker's
    `AttackRestriction.getViolation`, must-attack rules), clear the combat and ask again with `error`. This is the
    loop `declareBlockers` already has (lines 462-470). Forge then never sees an illegal attack, so its bare notice
    never fires.
  - Host only. `DeterministicController` (parity) is not touched. Forge itself is not changed.
- **Node image**: the node reads every prompt into the typed `AgentPrompt`
  (`manabrew-rs/crates/self-hosted-node/src/engine_backend/java_backend.rs:86, 1256, 1766`), so a field the Rust type
  doesn't have is dropped. The node image (`mtg-forge-node`) must be rebuilt (`engine/build-images.sh`), and the
  change goes into `engine/manabrew.patch` (it already carries protocol changes such as `choose_cards.rs` and
  `mulligan.rs`).
- **Relay**: no prompt types were found in `manabrew-rs/crates/manabrew-server/src` (no `AgentPrompt`, `PromptInput`
  or `ChooseAttackers`). It looks like prompts pass through as text, so the relay image likely needs no rebuild.
  Confirm that before deploying.
- **Bridge**: use the new fields when present, the text reading when not. The refusal reads `input.error`.
- **Table**: nothing more than part 2.

## 6. Test plan

Debug scenarios go in `scenarios/` and run with `mtg debug <name>` (see `scenarios/README.md` and
`scenarios/release-check.json`). Cards put on the battlefield by a scenario are never summoning sick, and there is
no way to attach an aura. So the sick creature and Pacifism are put in hand and cast in main phase 1 (`"mana": 99`).
Per-defender tests need a 3- or 4-player game: give each opponent colour its own part (`"Red": {...}`).

| Scenario | Board | What to check |
|---|---|---|
| `attack-taxes` | Red: Propaganda. Yellow: Ghostly Prison and Norn's Annex. Blue: Sphere of Safety with two other enchantments and a planeswalker. You: Grizzly Bears, Serra Angel, Llanowar Elves, `"mana": 99`. | Part 2 lists {2} at Red, {2}{W/P} at Yellow, {3} at Blue and at Blue's planeswalker. Each payment names its tax. Cancel on one payment leaves only that creature out. Llanowar Elves attacking can't pay. |
| `attack-taxes-poor` | The same, with `"mana": 0` and 2 lands. | Attack with three at Red. The second or third payment can't be made. Check what Forge does and what the player is told. |
| `attack-limits` | Red: Silent Arbiter. You: 4 creatures and Mogg Flunkies. | "All attack" is stopped with Silent Arbiter's limit (part 1, bridge side). Two attackers: refused by Forge, the refusal names Silent Arbiter and "You chose 2". Mogg Flunkies alone: named. |
| `attack-crawlspace` | The live case: one opponent with Crawlspace and Norn's Annex, you with 3 creatures. | "Crawlspace (White): no more than 2 creatures can attack White each combat. You chose 3." Then the Annex tax is named on the payment. |
| `cant-attack` | You: Wall of Omens, Serra Angel, Grizzly Bears on the battlefield. In hand: Pacifism, Hill Giant, Raging Goblin. | Cast Pacifism on Grizzly Bears, cast Hill Giant and Raging Goblin. The list reads "Grizzly Bears (Pacifism), Hill Giant (summoning sick), Wall of Omens (defender)". Raging Goblin (haste) is offered. Q/E on Hill Giant gives its reason. |
| `moat` | Red: Moat. You: Serra Angel, Grizzly Bears. | Grizzly Bears listed with Moat as the reason. Serra Angel is offered. |

Unit tests: the bridge cases in section 5, in `tests/golden/bridge-cases.js` and the bridge's other `tests/*.js`
files. For part 3, a harness test in the style of `MindslaverControlTest`, if the harness has one for prompts. Then
`/jr-programmer-suite` on the new code, as for every MTG task.

**Read these strings from the running engine before writing the tests** (with `MTG_RAW=1` on the bridge, or the
engine's `/card` and `/state`), when no game is being played. Guessed strings have passed tests and failed live here
before.

1. The exact refusal title. Seen live as "Attack declaration invalid". Check what
   `MessageUtil.formatNotificationMessage` adds around it.
2. A full `chooseAttackers` prompt: the order of `validTargetIds`, and the `attackTargets` labels for a player and
   a planeswalker.
3. Each tax payment's `cardName` and `manaCost`: Propaganda's {2}, Norn's Annex's {W/P}, Ghostly Prison plus
   Norn's Annex together, and Sphere of Safety. Forge builds Sphere's cost as "3 X" with X set to 0
   (StaticAbilityCantAttackBlock lines 318-322), so its `manaCost` text is not certain. Also whether "Pay 2 life" is
   offered for the Annex.
4. The `text` of every card in the scenarios as the board sends it. The cardsfolder `Oracle:` lines are the source
   (for example Crawlspace: "No more than two creatures can attack you each combat."; Norn's Annex starts with its
   "({W/P} can be paid with either {W} or 2 life.)" reminder). Check the board's copy, not the file.
5. The `keywords` strings for Defender, Flying and Haste, and `summoningSick` for a haste creature cast this turn.
6. After part 3: the new fields as the node passes them on.

## 7. Size

| Part | Work | Hours |
|---|---|---|
| 1 | Bridge: refusal reasons, "All attack" stop, unit tests | 2-3 |
| 2 | Bridge: reminder from rules text, tax payment wording, can't-attack list, unit tests | 4-6 |
| 2 | Table: Q/E reason, save rebuild, screenshot check | 1 |
| 3 | Protocol fields, harness code, refusal loop, patch regenerate, node image rebuild, bridge switch-over | 8-12 |
| all | Live strings, the six scenarios in real TTS, fixes | 2-4 |

Parts 1 and 2 (bridge and table only): about 8-10 hours. All of it: about 17-26 hours.

Deploy notes: a bridge change needs a bridge restart, so not during a game. Part 3 needs an engine image built on top
of the image that is waiting to go out (release-1110, `deploy --image reveal` next).

## 8. Open questions for the user

1. When a player is taxed, should their opponent see it too? For example White sees "Blue is paying {2} per creature
   attacking you (Propaganda)."
2. Is text in the corner hint and the engine panel enough, or do you want a real pop-up with an OK button before the
   attack question when a tax or limit applies?
3. When "All attack" would break a limit, should the bridge stop and say so (the proposal), pick for you (for example
   your biggest creatures up to the limit), or send it to Forge anyway?
4. Should the reminder say how much mana you have open, knowing it is only a guide?
5. Should summoning-sick creatures be listed every turn, or only when nothing else is in the list? A token deck could
   make that line long.
6. Should the tax payment offer "Don't attack with X" instead of "Cancel"?
7. Maze of Ith and similar "untap target attacking creature" cards: leave them out (the proposal), or remind the
   attacker that they're on the table?
8. Part 3 needs an engine rebuild. Do parts 1 and 2 first and see if text reading is good enough?
