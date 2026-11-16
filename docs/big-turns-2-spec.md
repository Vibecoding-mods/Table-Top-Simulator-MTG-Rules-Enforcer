# Big turns 2: infinite tokens, responses, attack taxes, split attacks, ties

Spec only, 2026-11-16. Nothing here is built. It sits on top of branch `big-turns` (9cedf2d, cee1f5f; see
`docs/big-turns.md`). All file paths were read in a scratch tree: Forge `e7d2b93b` and Manabrew `fd16e2f` with the
big-turns `engine/forge.patch` and `engine/manabrew.patch` applied, plus the bridge and renderer of `big-turns`.

Short names used below:
- **Game.java** = `forge-game/src/main/java/forge/game/Game.java`
- **Session** = `forge-harness/src/main/java/forge/harness/host/ManaBrewInteractiveSession.java`
- **Controller** = `forge-harness/src/main/java/forge/harness/host/ManaBrewInteractiveController.java`
- **Protocol** = `manabrew-rs/crates/manabrew-protocol/src/` (the Java DTOs are generated from it when the
  `java-builder` image is built: `self-hosted-node/Dockerfile` stage 0, `gen-protocol`)

**One build fact drives the plan.** A new protocol field needs a new `java-builder` image, because
`engine/checks/harness-tests.sh` compiles the harness against the image's generated `forge/harness/protocol` classes.
A Forge change needs a new image too. A harness-only change does not. So the protocol fields of all five items go in
one first step (section 7).

---

## 1. Infinite tokens; remove the token-limit draw

**Feasible: yes.**

### 1.1 Today

- `Game.recordTokenRequest(count)` is called from `TokenEffectBase.makeTokenTable` (line ~116), once per cell of the
  token table, after the CreateToken replacements (doublers) ran. Past `DEFAULT_RUNAWAY_TOKENS_PER_EFFECT` (100) it calls
  `askOrDraw`: the "Keep going / End in a draw" question, or a draw.
- Each cell is one prototype and its amount. Second Harvest makes one cell **per token** with amount 1, so the 100 cap
  never sees it. The live 448 Scute Swarm turn grew by many small effects. A per-effect cap alone does not stop either.

### 1.2 Recommendation: a capped real count plus an "infinite" flag

Keep real Forge tokens up to one constant. Past it, make no more, and mark the pile infinite. All rules keep reading
the real count.

Why not one token object with an infinite marker: Forge counts objects everywhere. Combat assigns and blocks per
creature. "Sacrifice a creature", "for each creature you control", `Count$Valid`, the AI, the snapshot and rewind all
iterate real cards. A marker would need changes at hundreds of call sites, and every miss is a wrong rule. The capped
count is right by construction; it only means "at least CAP".

### 1.3 The constant

- `Game.UNBOUNDED_TOKENS` (one `public static final int`, placeholder 500). The benchmark agent sets the number.
  It replaces `DEFAULT_RUNAWAY_TOKENS_PER_EFFECT`, `runawayTokensPerEffectCap` and `setRunawayTokensPerEffectCap`
  (no callers in the harness or the node).

### 1.4 What the engine does

- **The pile key:** `TokenPile.key(Card)` (new small class in `forge.game.card`): controller id, name, and the token's
  base power/toughness. Tapped state, counters and damage are not in it (the table splits those piles by itself).
- **The clamp** (in `TokenEffectBase.makeTokenTable`, at the `recordTokenRequest` call, after replacements):
  for each cell, `room = UNBOUNDED_TOKENS - (tokens of that key on the battlefield + made so far in this effect)`.
  Make `min(cellAmount, room)`. If any were cut, add the key to `Game.unboundedTokenKeys`.
  This covers one big effect (128 from doublers), Second Harvest (many cells, one key) and a Scute Swarm pile that
  grows by many effects.
- **No question and no draw.** `recordTokenRequest` and the "One effect asks for N copies" text in
  `Session.keepGoingPastCap` are removed.
- **The flag:** `Game.unboundedTokenKeys` is a `Set<String>`. It is game state, so `GameSnapshot.copyGameState` copies
  it (rewind and restore points keep the infinity). A getter prunes keys that no longer have a token on the
  battlefield. So a wipe clears it, and a pile that loses some tokens stays infinite.
- **Card count:** cut tokens are never made, so they never reach `nextCardId` or the per-turn card cap.

### 1.5 How an infinite pile behaves

It is exactly CAP real tokens (or fewer after some left). Say so in the hover text.
- **Combat damage:** each token deals its own damage. CAP 1/1s deal CAP. At 40 life that is lethal unblocked.
- **Blocking:** the defender blocks as usual. Each blocker stops one token.
- **Sacrifice:** "sacrifice a creature" takes one. The pile stays infinite. "Sacrifice all" empties it, and the flag goes.
- **"For each" counts** (`Count$Valid`, devotion, "for each creature you control"): the real count, CAP.
- **Enter-the-battlefield triggers:** tokens that were cut never enter, so Impact Tremors or a landfall copy does not fire
  for them. This is the point: it is what keeps the turn finite.
- **Control change:** a stolen token gets a new key (new controller) and is not infinite.
- **Rules note:** the infinite-loop rules (CR 104.4b; the user's "732?", check the current number) have a player with an
  optional loop name a number. CAP is that number, chosen for them. Write this in the engine change log.

### 1.6 What the bridge and table get

- Protocol `game/mod.rs` `CardDto`: `unbounded: bool` (`serde(default, skip_serializing_if = "Not::not")`).
  `InteractiveSnapshotExtractor` sets it when the card is a token whose key is in `unboundedTokenKeys`.
- Bridge: the table message carries `inf = true` on those cards (a compact key next to `tok`).
- Bridge log: "Blue creates infinitely many Scute Swarm tokens (the engine stops counting at 500)." The count line at
  bridge.js ~5044 (`creates ${made.n} ${base} tokens`) gets the branch.
- Renderer (`tools/engine-renderer.lua`): `badgeParts` shows `"x∞"` instead of `"x" .. c.groupN` when any member of the
  group has `inf`. `inf` is **not** part of `engineTokenKey`, so flagged and unflagged tokens of a kind stay one pile.
  Hover: "Infinitely many (the engine keeps 500 real tokens)."
- Risk: TTS's button font may not draw "∞". Check with `tools/tts-shot.ps1`. Fallback: "xINF".

### 1.7 Every other place a game is drawn or ended because of a loop or a limit

| Where | What | Plan |
|---|---|---|
| `Game.recordTokenRequest` | 100 tokens per effect: ask, else draw | **Removed** (1.4). |
| `Game.recordTriggerFired` → `askOrDraw` | 25,000 triggers a turn: ask "Keep going / End in a draw" | **Kept**, with the changes below. |
| `Game.nextCardId` → `askOrDraw` / `endRunawayGame` | 25,000 cards a turn: asked at the next trigger; two caps before that = silent draw | **Kept** as a question. The silent "two caps before the ask" draw stays only as the memory backstop below. |
| `Game.askOrDraw` | 4th limit in a turn (`RUNAWAY_CONTINUES_PER_TURN` = 3) = silent draw | **Removed.** Every limit asks. |
| `Session.keepGoingPastCap` | a pass or a timeout = draw | **Changed:** a timeout = "Keep going". Two timeouts in a row in one turn = draw (nobody is there). |
| `Game.askOrDraw` with no person in the game | AI-only = draw | **Kept.** Only tests and parity runs have no person. |
| `MagicStack.add` (stock Forge) | stack over 999 items = silent draw ("Scalelord Reckoner mirror") | **Changed:** asks through the same `RunawayChoice` ("1,000 items are on the stack"); "Keep going" allows 1,000 more. |
| `PhaseHandler` priority loop (`getPriorityLoopLimit`) | forces a pass, logs a warning | No draw. Unchanged. |
| `GameAction.checkGameOverCondition` | every player lost at once = draw (CR 104.4a) | A rules result. Unchanged. |
| `GameDrawEffect` | a card says the game is a draw | A card. Unchanged. |
| `Session.close()` | room shut down mid-game = draw | Not a loop. Unchanged. |
| `harness/Main.java` turn limit; `DeterministicController.stopIfCardCopyGuardTripped` | parity harness only | Not live games. Unchanged. |
| Node and relay (`self-hosted-node`, `manabrew-server`) | searched: no game draws | Nothing. |

- **Kept on purpose:** the players' own "End in a draw" button at the runaway question. Choosing it still draws.
  The question's text loses "Keep going allows as many again (N more times this turn)" and says "Keep going allows as
  many again. The engine asks again at the next limit."
- **Memory backstop (owner decision):** with the 3-a-turn limit gone, a real infinite mandatory loop could run until
  the JVM runs out of heap and takes co-tenant games with it (`-XX:+ExitOnOutOfMemoryError`). Proposal: at a limit, if
  used heap is over 85 % of `Runtime.maxMemory()`, the game ends as a draw with the words "The engine ran out of room
  for this turn." This is the only silent draw left.
- Bridge (bridge.js ~8131, ~8974): the question is shown as today. The end-of-game words (~6049) drop the token text.

### 1.8 Files

- Forge (`engine/forge.patch`): Game.java (constant, `unboundedTokenKeys`, ask changes, memory backstop),
  `card/TokenPile.java` (new), `ability/effects/TokenEffectBase.java` (clamp), `GameSnapshot.java` (copy the set),
  `zone/MagicStack.java` (999 asks).
- Harness: Session `keepGoingPastCap` (text, timeout), `InteractiveSnapshotExtractor` (`unbounded`).
- Protocol: `game/mod.rs` `CardDto.unbounded`; `manabrew-agent-interface/src/game_view_dto.rs` maps it (false).
- Bridge: table message `inf`, log line. Renderer: badge, hover.

### 1.9 Tests

- `UnboundedTokensTest` (harness): one effect asking for CAP+1 makes CAP and flags the key; a doubler doubling past CAP;
  Second Harvest on a CAP pile makes nothing; a Scute Swarm pile stops at CAP; sacrifice one keeps the flag; a wipe
  clears it; `Count$Valid` reads CAP; combat damage is CAP × power; no `RunawayChoice` call; a GameSnapshot restore
  keeps the flag; the snapshot JSON has `unbounded`. Break-its: no clamp, no copy in GameSnapshot, flag in the token key.
- `BigTurnsTest` changes: the token checks go; the fourth trigger limit asks; a timeout keeps going; two timeouts
  draw; "End in a draw" still draws; the stack at 1,000 asks; the memory backstop (inject a heap reader).
- Bridge `tests/test_bridge_unbounded_tokens.js`; table check for the "x∞" badge in `tests/test_table_trigger_groups.js`.
- `BigTurnTimingTest` with ARGS at the chosen CAP, for the benchmark agent.

### 1.10 Risks

- **Rewind:** the set must be in `GameSnapshot`, or a rewind loses "∞". The runaway counters are Game fields that
  rewind does not restore (today too): after a rewind the same turn's counts carry on. Harmless.
- **Runaway limit:** the clamp keeps token floods away from the card cap. Trigger loops still reach it and ask.
- **Rules:** a pile at CAP takes no new tokens, so "whenever a token enters" stops. Say it in the hover text.
- **Pile key too coarse:** two different 1/1 "Soldier" tokens of one player share a key. Acceptable: both are piles of
  Soldiers.

---

## 2. Responses while merged or exhausted triggers resolve

**Feasible: yes. Mostly true already; one gap to close.**

### 2.1 Where priority is given or skipped today

1. **Bridge, each priority prompt** (`bridge.js` `chooseAction`, ~8390-8545): a seat is asked when `worthStopping` is
   true. For someone else's trigger that is `actions.length && opponentsStack`: **an opponent who can respond is
   asked.** Only when nothing is worth stopping does it answer by itself, through `heldPass`.
2. **Bridge, `heldPass`** (~8133): only on a pass the bridge makes by itself, and only when the whole stack is one run of
   5+ alike untargeted abilities, it adds `exhaustStack: true`. It is also used by the player's own choices: End turn,
   Resolve all, Resolve N×, auto-resolve, `mtg skip`. Those hold even with a response in hand; that is the player's choice.
3. **Engine, held pass** (Controller `chooseSpellAbilityToPlay`): while `exhaustStackIds` is set it returns a pass
   without prompting. It ends (`PriorityFastForward.exhaustEnded`) when the stack empties, a new item goes on it, or
   20 items of the run have resolved.
4. **Engine, merge** (`MagicStack.resolveAlike`): up to 19 more alike items resolve with **no priority at all**. Only
   when `Session.heldByEveryone` says every living player is a person whose held pass covers them, and only GainLife
   items on the `StackMerge` allowlist.
5. **AI seats** always get priority after each resolution (Forge AI). Any AI seat turns merging off.

### 2.2 The gap

A held player is not looked at again for up to 20 resolutions. If a trigger in the run gives them a response (a card
drawn, a land untapped, mana from a trigger), they are not asked until the hold ends. The bridge would have asked.

### 2.3 Fix (engine only, no protocol change)

- Controller: when a held pass starts, store the ids of the player's playable non-mana actions (`ActionSpace
  .getPossibleActions`, measured 2-8 ms in `docs/big-turns.md`). At each held priority, compute them again. A new id
  ends the hold, and the player gets a normal prompt. The bridge then decides as it always does (it may hold again).
- `heldResolutionsLeft` returns 0 when the set changed, so the merge gate stops too.
- Optional, needs a protocol field: a `releaseHold` directive so `mtg stop` lands at once instead of within 20. Put
  it in step 0 (section 7) only if wanted.

### 2.4 Tests and risks

- `HeldPassResponseTest`: a held run where trigger 3 draws an instant ends the hold at trigger 4; a run that changes
  nothing stays held for 20; the merge gate returns 0 after the change.
- Bridge: `tests/test_bridge_big_turns.js` gets a case where an opponent with an instant is asked on every trigger.
- Risk: cost. 2 × 75 action lists is about 1 s on the live case. Acceptable next to the 73 s it replaced.
- Risk: an action that is playable but useless (a mana-less ability) ends a hold. Filter mana abilities as the bridge does.

---

## 3. Attack tax: pay for the minimum lethal attackers

**Feasible: yes.** Effective damage is computed in the harness with Forge's own AI helpers. The choice and the
automatic payment live in the bridge.

### 3.1 Today

- Forge: `PhaseHandler` declare-attackers turn-based action (~770-830) taps the attackers, then for **each** attacker
  calls `CombatUtil.checkPropagandaEffects` → `getAttackCost` (sums every static `CantAttackUnless` and chosen
  `OptionalAttackCost`) → `PlayerController.payCombatCost`. A refused payment removes that attacker
  (`combat.removeFromCombat`) and revalidates.
- Harness: Controller `payCombatCost` → `HarnessCostPlumbing.payWithControllerDecision` → one mana payment prompt per
  attacker. `Session.publishAttackersPrompt` sends each attacker's `costs` per defender (`attackCosts`, `AttackCostDto`).
- Bridge: `chooseAttackers` (~9693) builds the picks, `attackWhom` asks "whom?", then `declare`. Each payment comes as
  a `payManaCost` prompt; bridge.js ~8690 titles it "Ghostly Prison (Blue): pay {2} to attack with X?" with "Don't
  attack with X".

### 3.2 Engine: send effective damage

- Protocol `prompts/choose_attackers.rs`: `AttackerOptionDto.damage: Vec<AttackDamageDto>` (`serde(default)`).
  `AttackDamageDto { defenderId, damage, poison, commander }`.
- Session `publishAttackersPrompt`, next to `attackCosts`, per legal defender:
  - `damage` = `ComputerUtilCombat.damageIfUnblocked(attacker, defender, combat, false)`. It counts the net combat
    damage, known pumps (`predictPowerBonusOfAttacker`), double strike, prevention (`isCombatDamagePrevented`,
    `predictDamageTo`) and returns 0 when the player can't lose life. Infect gives 0 here.
  - `poison` = `ComputerUtilCombat.poisonIfUnblocked(attacker, player)` (infect, toxic, poisonous; 0 under Solemnity).
  - `commander` = the attacker's damage when it is a commander and the defender is a player (counts toward 21).
- Per defender, once per prompt (new `AttackTargetDto` fields): `life` (team life with shared life), `poisonLeft`
  (`getPoisonCountersToLose` minus current), `commanderLeft` per commander, and `canLose` (false when
  `cantLose()` or `cantLoseForZeroOrLessLife()`). A planeswalker gets `life` = loyalty, a battle its defense.

### 3.3 Bridge: the plan

After `attackWhom` and before `declare` (bridge.js ~9745), for each taxed defender D with picked attackers S:
1. Sort S by `damage` toward D, highest first (ties: the cheaper tax first, then label order).
2. k_life = the shortest prefix whose damage sum ≥ D's life. k_poison = the same on `poison` vs `poisonLeft`.
   k_cmd = 1 if one commander's `commander` ≥ its `commanderLeft`. k = the smallest of these. If none is lethal,
   or D can't lose, k = |S|.
   - 40 life: 40 1/1s, 20 2/2s, 14 3/3s, 10 4/4s. A mixed stack takes the highest power first.
   - With no `damage` field (older engine): power, as a fallback.
3. Ask: title "Ghostly Prison (Blue): {2} for each attacker". Text "14 of your 20 attackers deal lethal damage to Blue
   (40 life). Pay {28} for those 14? The other 6 stay home." Buttons: "Pay for 14", "Don't attack Blue", "Back".
   When k = |S|: "Pay {40} for all 20?"
4. **Yes:** only those k attack D; the rest of S stay home. The bridge sends them first, in that order, and stores
   `seat.taxPlan = { defender, ids }`.
5. **No:** nothing in S attacks D; all of S stay home (not sent at another defender).
6. **Payment:** Forge then asks per attacker. Each `payManaCost` prompt for an attacker in `seat.taxPlan` is answered
   "Auto-pay" with no prompt. The first one auto-pay can't finish is answered "cancel", and so is every later one for
   that defender: "as many as they can". Chat: "Paid for 9 of 14 attackers at Blue; the other 5 stay home."
7. **Norn's Annex ({W/P}):** auto-pay uses mana first. Life is paid only when the player turned that on, and never to 0.

### 3.4 Risks and checks

- **Payment order** follows `combat.getAttackers()` (bands per defender, in declaration order). The test must prove the
  highest-damage attackers are paid first.
- **A removed attacker breaks a must-attack requirement:** Forge revalidates and asks the whole declaration again
  (`validateAttackers`); the bridge keeps the plan only for the same defender and attacker ids.
- **Estimates:** `damageIfUnblocked` ignores blockers and some attack triggers. The ask says "unblocked".
- **Rewind:** none. Declaration has no priority, so no restore point is taken. The payment snapshot inside the
  Controller (`beginManaPaymentSnapshot`) is unchanged.
- **Runaway limit:** none.
- **2HG:** use team life and the team's poison; Level 2 declares per partner, so the plan is per partner's own creatures.

### 3.5 Tests

- `AttackTaxLethalTest` (harness): 20 Grizzly Bears into Ghostly Prison at 40: `damage` 2 each; a Giant Growth'd
  creature counts 5; double strike doubles; infect gives `poison` and 0 `damage`; a commander shows `commander`;
  Platinum Angel sets `canLose` false; payment order follows declaration order; a cancel removes only that attacker.
- Bridge `tests/test_bridge_attack_tax_lethal.js`: the four examples above; mixed stack; can't-afford stops at the first
  failed auto-pay; decline keeps all home; fallback without `damage`.

---

## 4. One stack per defending player

**Feasible: yes. The drawing is already built; the choice is not.**

### 4.1 Today

- Engine and harness: every token is its own attacker. `declareAttackers` takes `{attackerId, targetId}` per token.
  Nothing knows about stacks.
- Renderer: `groupTokens` draws one stack per kind; `engineCombatSubs` (~6949) already cuts a kind into **one stack
  per attack target** (`atkT`, or the open question's picks). So 7 / 7 / 6 tokens at three players already draw as
  three stacks.
- Choosing: a click on a stack picks all of them; a click on a life counter sends them all at that player. The
  right-click menu (`engineStackMenus`, ~7105) has "Attack with all N", "Attack with one", "Pick one by one". The
  bridge's `attackWhom` asks one "whom?" for the group or "One by one" (one question per token).

### 4.2 Add

- Renderer menu item "Split among opponents" (only when the stack can attack 2+ players). Bridge `attackWhom` option
  "Split evenly: Blue 7, Red 7, Yellow 6" when a group of 2+ creatures has 2+ player targets.
- Split rule: players only (not planeswalkers or battles), in seat order from the attacker's left; each gets
  floor(N/k), the first (N mod k) one more. A token that can't attack a player (a "can't attack Blue" rule) goes to the next.
- With taxes (item 3): each defender's share gets its own tax question. "Split evenly" then pays per defender.
- Log: "Red attacks Blue with 7 Zombie tokens, Red with 7, Yellow with 6."

### 4.3 Files, tests, risks

- Bridge (`attackWhom`, the attack log), renderer (`engineStackMenus`, `engineStackAttack`). No engine change.
- Tests: `tests/test_bridge_stack_split.js` (20 into 3 players; a token barred from one player; with an ∞ pile of CAP);
  a renderer check that the three stacks draw as three objects, not 20.
- Risk: an "attacks alone" or Crawlspace limit. `attackRefusalReason` already stops "All attack" over a limit; run it
  on the split too.

---

## 5. Tie offer

**Feasible: yes.** Forge already has a draw offer: `forge.game.DrawOffer` (votes) in forge-game and
`forge.gamemodes.match.DrawOfferCoordinator` in forge-gui. The coordinator talks to `PlayerControllerHuman` GUIs, so
the harness writes its own, modelled on the rewind vote (`Session.RestoreVote`, `gameView.restoreVote`).

### 5.1 Detecting a stalemate (harness, at the start of each turn)

A player P has a **lock** when one of these holds:
- **Can't lose:** `P.cantLose()` (a `GameLoss` replacement with `Layer$ CantHappen` and no reason filter). Platinum
  Angel, Angel's Grace, the Gideon of the Trials emblem with a Gideon, Everybody Lives.
- **Life can't fall:** `!P.canLoseLife()` (`CantLoseLife` / `CantChangeLife`: Platinum Emperion, Teferi's Protection).
- **Damage can't kill:** `P.cantLoseForZeroOrLessLife()` (Phyrexian Unlife, Lich) **and** no poison is possible
  (`!P.canReceiveCounters(POISON)`: Solemnity) **and** no opposing commander can still deal combat damage to P.
- **All damage prevented:** for every creature an opponent controls,
  `ComputerUtilCombat.predictDamageTo(P, 1, creature, true) == 0` (Gideon's prevent on the only threat, Teferi's
  protection from everything).
- **Fog lock:** no static sign. Counted instead: 2 rounds in a row in which creatures attacked P and every point of
  combat damage to P was prevented (from the harness's `EngineEventLog` damage events).

False positives (each only opens an offer; none forces a tie by itself):
- Lich and Phyrexian Unlife: the player can still lose to commander damage, mill or Lich's own trigger.
- Angel's Grace and Everybody Lives last one turn; the signal goes at the next turn start.
- Platinum Angel can be removed. Prevention on one creature leaves other sources (burn, drain).
- A Fog lock needs the opponent to keep a Fog each turn; 2 rounds can be luck.

### 5.2 The offer

- When a lock first appears, every person gets a corner question "Offer a tie?" from the bridge, and the table shows a
  **Tie** button (a prompt option, not `UI.setValue` on a Button, which real TTS ignores). `mtg tie` offers one at any time.
- The offer goes to the engine (`offerTie`); every living player votes (`tieVote`), as the rewind vote does.
- **AI seats:** Forge's `PlayerControllerAi.acceptsDrawOffer()` returns false. Proposal: an AI accepts an
  engine-raised stalemate offer and declines a plain `mtg tie`. Owner decision.
- **All accept:** every player `intentionalDraw()`, then `setGameOver(GameEndReason.Draw)` (Forge's own path, as
  `DrawOfferCoordinator.resolve` and `GameDrawEffect` do). Chat: "Everyone agreed to a tie."

### 5.3 Forced tie (proposed rule)

- Starts when an offer is declined. A **round** = every living player has started a turn once.
- **Progress** in a round = any of: a player's life total goes down; a player gets poison or commander damage; a
  permanent leaves the battlefield (tokens count); a card goes from a library to a graveyard by an effect (mill);
  a player loses.
- **3 rounds in a row with no progress, while the lock still holds** = a forced tie at the start of the next turn.
- Any progress resets the count to 0. The lock ending (Angel removed) stops it.
- Said each round to everyone: "No progress for 2 of 3 rounds. A forced tie comes after the next round unless a life
  total drops or a permanent leaves."
- This is a house rule. The CR has no forced tie. Write it in `docs/engine-changes.md` and `HOW-TO-PLAY.md`.

### 5.4 The accomplishment

- Forge's achievements (`forge-gui/.../localinstance/achievements`, `AchievementCollection`) need `FModel`, a desktop
  profile and files under `ForgeConstants.ACHIEVEMENTS_DIR`, updated per `PlayerControllerHuman`. In the headless
  container they would live in a throwaway filesystem with no link to a TTS player. **Not usable.**
- Nothing in our repo hosts accomplishments (searched bridge, tools, table, companion).
- **Proposal:** the bridge stores them like GIF favourites: `%APPDATA%/MTG-TTS/accomplishments.json`, keyed by Steam
  ID (else colour), written whole and renamed (`gifFavs` store pattern, bridge.js ~12155). First entry: "Stalemate:
  played a game to a forced tie", with the date and the lock's card name. On the table: a chat line and a gold toast.
  `mtg accomplishments` lists a player's own.

### 5.5 Files

- Harness: Session (a `TieVote` like `RestoreVote`; lock signals at each turn start; the stall counter; the forced
  tie), Controller (none), `ManabrewProtocolAdapter.translateDirective` (`offerTie`, `tieVote`).
- Protocol: `transport/mod.rs` `DirectiveInput::OfferTie`, `TieVote { voteId, accept }`;
  `game/mod.rs` `GameViewDto.tie_vote: Option<TieVoteDto>` and `stalemate: Option<StalemateDto>` (the lock's player,
  card, and rounds without progress).
- Forge: none. `DrawOffer`, `cantLose`, `canLoseLife`, `cantLoseForZeroOrLessLife` already exist.
- Bridge: the offer and vote questions, `mtg tie`, the round notices, the accomplishments store.
- Renderer: the Tie option on the question, the toast.

### 5.6 Tests and risks

- `TieOfferTest` (harness): each lock signal on its own (Platinum Angel, Angel's Grace, Platinum Emperion, Phyrexian
  Unlife + Solemnity with no commander, Gideon's prevent); a unanimous vote ends in a draw with every player's outcome a
  draw; one decline then 3 quiet rounds = a forced tie; a life loss in round 2 resets it; the Angel leaving stops it; an
  AI vote follows the rule in 5.2.
- Bridge `tests/test_bridge_tie.js`: questions, notices, the store written once per forced tie.
- **Rewind:** the stall counter and an open tie vote live in the Session, not in Forge, so a restore must reset the
  counter to the restored turn and close the vote. No tie vote while a rewind vote is open, and the other way round.
- **Runaway limit:** a stalled game is not a big turn; no overlap. A runaway question open at a turn start delays the
  check to the next turn.
- **Forced tie on a real game:** a slow control mirror with a Platinum Angel and no attacks for 3 rounds gets tied.
  The round notices are the guard.

---

## 6. Summary table

| Item | Feasible | Forge | Harness | Protocol | Bridge / renderer |
|---|---|---|---|---|---|
| 1 Infinite tokens | yes | Game, TokenPile, TokenEffectBase, GameSnapshot, MagicStack | Session, InteractiveSnapshotExtractor | `CardDto.unbounded` | `inf`, log, "x∞" |
| 2 Responses | yes (one gap) | none | Controller, PriorityFastForward | optional `releaseHold` | test only |
| 3 Attack tax | yes | none (uses forge-ai) | Session `publishAttackersPrompt` | `AttackDamageDto`, defender fields | tax plan, auto-pay |
| 4 Split stacks | yes | none | none | none | `attackWhom`, stack menu, log |
| 5 Tie | yes | none | Session tie vote, signals, counter | directives, `tieVote`, `stalemate` | questions, store, toast |

## 7. Implementation order (parallel)

**Step 0 (one agent, short, first).** All protocol fields at once: `CardDto.unbounded`, `AttackDamageDto` and the
defender fields, `OfferTie` / `TieVote` directives, `tieVote` and `stalemate` on the game view, optional
`releaseHold`. Fill each with its default in the harness (false, empty, none) so behaviour is unchanged. Regenerate
`engine/manabrew.patch`. Build one image, `mtg-harness-test:bt2-proto`, and run the default harness classes and
`tests/test_bridge_golden.js` to prove nothing moved. Log it in `docs/engine-changes.md`.

Then three agents in parallel, each in its own worktree from step 0:

- **Agent A, engine (items 1 and 2).** The only one who touches `engine/forge.patch`, so the only one who builds a new
  image. Game, TokenPile, TokenEffectBase, GameSnapshot, MagicStack; Session `keepGoingPastCap`; the snapshot field;
  the held-pass action check. Bridge: only the `inf` key and the token log line. Renderer: only `badgeParts` and hover.
  Tests: `UnboundedTokensTest`, `BigTurnsTest` changes, `HeldPassResponseTest`, the bridge and table checks.
  Takes the benchmark agent's number for `UNBOUNDED_TOKENS` last.
- **Agent B, combat (items 3 and 4).** Harness-only Java (Session `publishAttackersPrompt` and its helpers), so it uses
  the step-0 image. Bridge: `chooseAttackers`, `attackWhom`, the `payManaCost` tax branch, the attack log. Renderer:
  `engineStackMenus`, `engineStackAttack`. Tests: `AttackTaxLethalTest`, the two bridge test files.
- **Agent C, tie (item 5).** Harness-only Java (Session tie vote, signals, counter; `ManabrewProtocolAdapter`), the
  step-0 image. Bridge: the tie questions, `mtg tie`, notices, the accomplishments store (new file
  `bridge/accomplishments.js`, required from bridge.js). Renderer: toast. Tests: `TieOfferTest`, `test_bridge_tie.js`.

**Conflicts to expect.** All three edit Session (different methods), `engine/manabrew.patch` (regenerated), bridge.js
and the renderer (different functions), and `docs/engine-changes.md`. Merge A, then B, then C, each with the
source-level merge used for the Archenemy rows (apply each patch in a clean `fd16e2f` tree, commit, merge with git,
regenerate). Add the new test classes to the `harness-tests.sh` defaults in the merge, not in each branch.

**Per agent, as the project rules say:** a second agent runs `/jr-programmer-suite` on the new code; heavy tests go
through `tmp/slot.js`; one local commit when the piece is done; no push.

**Owner decisions before building:**
1. The pile cap (1.4) on top of the per-effect cap. Recommended: yes, it is what stops Second Harvest and Scute Swarm.
2. The memory backstop draw (1.7), and "two timeouts in a row = draw".
3. AI votes on a tie (5.2).
4. 3 rounds and the progress list for a forced tie (5.3).
5. In item 3, whether to offer "Pay for all N" besides the lethal minimum.

## Decisions (the user, 2026-11-16)

All yes:
1. Tokens are capped per pile as well as per effect.
2. Two runaway questions missed in a row in one turn end the game in a draw.
3. A safety draw when the engine heap is over 85% full.
4. AI players accept a tie offer when the lock is real.
5. The attack-tax question offers "Pay for all" next to the lethal minimum.
6. The forced tie comes after 3 rounds with no progress (default kept).
7. Attacks split into one stack per defending player automatically.
