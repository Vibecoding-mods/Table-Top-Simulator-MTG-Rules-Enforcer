# M7 spec: manual fix mode (hand-edit the board, the engine takes it back)

Status: §1-11 built 2026-10-23, except §3's snap points (`dropArea` reads the zones instead, §11); §12 (fix from hand)
built 2026-11-05 (engine images :fixhand, bridge, table; jr-programmer-suite run, 2-player test pending). Board edit built 2026-10-23 (engine handler, bridge, table; see "As built" at the end) and running
on our node image (`mtg-forge-node:exile`); `mtg debug` sets up its boards through it (2026-11-04). Waiting on a
2-person live test. Spec written 2026-10-20. Extends SPEC.md §10c Tier B. Rewind by vote (Tier A, M4.5) is built; this is for what a
rewind can't fix: the engine got a rule wrong, or the mistake is older than the ~3 turns of restore points Forge keeps.

## 1. The idea in one paragraph

The players vote to pause the engine. The engine's cards on the table unlock, and the players move them **onto fixed
spots the table knows** (snap points on every playmat). When someone presses **Done**, the table reads every engine
card's spot and turns it into an exact change list ("Llanowar Elves: Red's graveyard → Red's battlefield, tapped").
Everyone sees the list and votes again. The bridge then sends the list to the engine as one new directive,
`applyState`. The engine records a restore point, applies the changes without triggering anything, checks
state-based actions, and play resumes from the fixed board.

The key design choice is the **snap points**: a card is never "somewhere near" a zone. Each spot belongs to exactly
one zone of one player, so reading the board back is unambiguous, and a card left off every spot is flagged instead
of guessed.

## 2. What the table already has (built in M4)

- `dropArea(color, pos)` (`tools/engine-renderer.lua`) already sorts a position into one of the player's own areas:
  graveyard (zone object), library (zone object), battlefield (playmat), exile (4.16 units in front of the library),
  command (within 1.5 units of a command-zone label), else "elsewhere".
- `seatGeometry(color)` + `gridPos(g, col, row)` define where the engine lays cards out: battlefield rows
  (`ROWS = { creature = 0, other = 2, land = 3 }`, 10 columns of 2.4 units), graveyard and exile piles, the library deck,
  command spots (`TAX_LABELS`), the hand (`Player[color].getHandTransform()`).
- Every engine card carries `GMNotes = "engine:<engine card id>"` and the table keeps `engineMeta[id] = { zone, color }`.
- `engineFlipped`, the tap rotation (+90°), and the counter badge (`engineBadge`) are drawn from the engine's state.
- Rewind by vote (M4.5) has the vote pop-up and the bridge-side vote plumbing to reuse.

## 3. Snap points: the spots the engine understands

Built once per seat from the same geometry the renderer uses, so a card dropped on a spot lands exactly where the
renderer would put it:

| Zone | Spots | How it's read back |
|---|---|---|
| Battlefield | 3 rows × 10 columns per playmat (`gridPos`), rotation snap on (0° untapped / 90° tapped) | row/column → battlefield of the playmat's owner; Y rotation relative to the seat → tapped |
| Graveyard | 1 spot (pile) | the graveyard zone object, as `dropArea` |
| Exile | 1 spot (pile) | the exile spot, as `dropArea` |
| Library top | 1 spot on the library deck | → library, top |
| Library bottom | 1 spot beside the library ("bottom") | → library, bottom |
| Command | 1 spot per command label | → command zone |
| Hand | the player's TTS hand zone | `isInHand` (hidden from the others) |
| Attached | a spot slightly offset under its host | → attached to that host (aura/equipment) |

- TTS `obj.setSnapPoints({...})` on each playmat (positions are local to the playmat; rotation snap per point). The
  points are **only present during fix mode**, and removed afterwards, so normal play is unchanged.
- Other players' areas: a card dropped on **another player's playmat** means "under that player's control"
  (ownership never changes; control does).
- Reading back uses the nearest spot within 0.6 units. Further away, or on no spot, the card is marked **unplaced**
  (red glow, listed as "not on a spot") and Done is refused until it's placed.

**Not by position:**
- Counters, damage, life, poison and commander damage use the existing controls:
  - the counter badge becomes clickable, with − / + per counter kind;
  - life is edited with the table's own life counters, which are unlocked in fix mode only.
- Face up / face down uses TTS flip. A face-down card stays the same engine card (morph/manifest).
- Tokens: a **token box** spot per seat. "mtg token <name>" spawns a token card from Scryfall into the box. Once it is
  placed on the battlefield it becomes `createToken`.
- Cards can't be invented: a card that isn't an engine card (no `engine:` GMNotes) is ignored, and the list says so.

## 4. The change list

On **Done**, the Lua side compares each engine card's spot and state with `lastTable` and builds:

```json
{ "base": 4711, "ops": [
  { "op": "move", "card": "engine-card-120", "to": { "zone": "battlefield", "player": "player-1" } },
  { "op": "move", "card": "engine-card-77",  "to": { "zone": "library", "player": "player-0", "position": "bottom" } },
  { "op": "tap", "card": "engine-card-64", "tapped": false },
  { "op": "counters", "card": "engine-card-64", "kind": "P1P1", "n": 2 },
  { "op": "attach", "card": "engine-card-90", "to": "engine-card-64" },
  { "op": "control", "card": "engine-card-120", "player": "player-2" },
  { "op": "faceDown", "card": "engine-card-55", "value": true },
  { "op": "life", "player": "player-0", "n": 31 },
  { "op": "poison", "player": "player-3", "n": 4 },
  { "op": "commanderDamage", "player": "player-2", "from": "engine-card-199", "n": 14 },
  { "op": "createToken", "name": "Treasure", "player": "player-0", "tapped": false }
] }
```

- `base` = the engine state fingerprint/checkpoint the edit was made against. The engine refuses the list if the
  game has moved on (it shouldn't: the engine is paused, see §5).
- Only real differences are listed. A card put back where it was produces no op.
- Plain-English version for the review panel and chat:
  - "Llanowar Elves: Red's graveyard → Red's battlefield (untapped)"
  - "Blue life 31 → 34"
  - "New token: Treasure (White)"

## 5. Flow and votes

1. **Call:** "Manual fix…" (beside Undo…) or `mtg fix`.
   - Only with an empty stack and no question being answered mid-resolution (the bridge checks `stack.length === 0` and
     that the open prompt is a priority prompt).
   - Vote by every other human seat. Unanimous by default; `mtg fix rule majority` (host) switches to majority.
   - The vote is bridge-side, like M4.5's pop-up: all humans are bridge seats.
2. **Pause:**
   - The bridge stops answering and forwarding prompts, so the engine simply waits at its open priority prompt (no
     engine change needed for the pause).
   - TTS shows "MANUAL FIX" to everyone and adds the snap points.
   - Engine cards unlock for all seated players. The hand cards of others stay hidden; editing another player's hand
     isn't possible.
3. **Edit:** players move, tap, flip and count. A **Cancel** button redraws the engine's board (`engineRender(lastTable)`) and leaves fix mode.
4. **Done → review:** the change list goes to everyone (panel + chat). Unplaced cards block Done.
5. **Confirm vote:** same rule as step 1. A decline goes back to editing.
6. **Apply:**
   - The bridge sends `directive { type: "applyState", base, ops }`.
   - The engine replies with its next `state`, and the table redraws from it.
   - On an engine refusal, the bridge shows the reason and the table returns to editing.
7. **Log:** who called it, the votes and the exact ops go to the game log and the bridge log.

## 6. Engine work (the only part outside our code)

**Protocol** (`manabrew-protocol`, Rust + generated TS/Java DTOs):
- New `DirectiveInput::ApplyState { base: Option<u64>, ops: Vec<StateOp> }`, with `StateOp` tagged as above.
- Node: `route_remote_directive` already forwards directives with the sender's slot (engine-interface-reference §6).
  `applyState` needs no node change beyond the DTO.

**Forge harness** (`forge-harness/.../ManaBrewInteractiveSession.java`, new handler next to `requestRestore`):
1. Refuse if the game isn't waiting on a priority prompt with an empty stack, or `base` doesn't match.
2. Take a checkpoint (the same `GameSnapshot` the restore vote uses), so the fix itself can be rewound with M4.5.
3. Apply with triggers and replacement effects suspended:
   - `move`: `game.getAction().moveTo(zone, card, position, params)` with a "no triggers" flag (as Forge's dev mode and
     puzzle setup do).
   - `tap`: `card.setTapped`.
   - `counters`: `card.setCounters`.
   - `attach`: `card.attachToEntity`.
   - `control`: `card.setController` (a timestamped control effect).
   - `faceDown`: `card.turnFaceDown` / `turnFaceUp`.
   - `life` / `poison` / `commanderDamage`: the player setters.
   - `createToken`: `TokenInfo` by name.
4. Run `checkStateEffects` once (a creature at 0 toughness dies, a player at 0 life loses), then resume the prompt loop
   with a fresh priority prompt for the priority player.
5. On any exception: restore the checkpoint, reply with a `fatal`-free error (`code: "applyStateRefused"`, message).

**To verify first** (needs `git submodule update --init forge`):
- Forge's `forge-ai` `GameState` ("Setup Game State" in dev mode, used by puzzles) applies zones, tapped state,
  counters, attachments and life to a live game. Two options:
  - **Option A, preferred:** apply each op directly with the calls above. Engine card ids are kept, so the table's
    objects stay valid.
  - **Option B:** write the whole edited board as a `GameState` text and apply it. Robust, but `GameState` may create
    new card objects, so ids change and every table object would be respawned. Check whether `|Id:` keeps ids.
- Which Forge calls fire triggers by default (`moveTo` vs `changeZone`), and how dev mode suppresses them.

**Running it:**
- A modified node image (our fork of `witchesofthehill/forge` branch `manabrew` + `manabrew-protocol`), or upstream
  it as a PR to Manabrew. This is the better outcome, since everyone with Manabrew gets "judge mode".
- AGPL/GPL: private use is fine. If a modified relay or node is offered to others over the network, its source must
  be offered (SPEC §9).

## 7. Our code (bridge + table)

| Piece | Where | Work |
|---|---|---|
| Fix vote + pause | bridge.js | `game.fix = { state: "voting"\|"editing"\|"review"\|"applying", votes, rule }`; prompts held while ≠ null; `mtg fix`, `fixVote`, `fixDone`, `fixCancel` messages |
| Snap points | engine-renderer.lua | `engineFixSnaps(on)`: build/remove per playmat from `gridPos` + pile spots |
| Unlock / relock | engine-renderer.lua | fix mode lets `onPlayerAction` allow pick-up, rotate and flip for engine cards; `engineRender` skips the snap-back while editing |
| Read back | engine-renderer.lua | `engineFixRead()`: per engine card → zone/owner/position/tapped/face; unplaced list |
| Change list | engine-renderer.lua | diff against `lastTable` → ops + English lines |
| Review UI | engine-renderer.lua | reuse the card row panel (title, list, Confirm / Back / Cancel) |
| Apply | bridge.js | send `applyState`; on refusal return to editing |

## 8. Tests

- **Golden (bridge):** fix vote states, prompts held while editing, ops forwarded unchanged, refusal returns to editing.
- **Golden (table):**
  - snap read-back: a card on each spot type gives the right zone;
  - an off-spot card is "unplaced";
  - an unchanged board gives no ops;
  - tap by rotation;
  - another player's mat → `control`.
- **Engine (headless, `rules-check.js --game fix`):**
  - apply each op type on a real Forge game, then check the next `gameView`;
  - check that `move` battlefield → graveyard doesn't fire a "dies" trigger (Blood Artist on the board as the witness);
  - check that state-based actions run (0-toughness creature dies);
  - check that a bad op restores the checkpoint.
- **Mutation:** grade both goldens again (SOUND < 25% escapes).

## 9. Phases

1. **Spike (1 day):** check out the `forge` submodule and prove Option A on a headless game for `move` + `tap` + `life`.
2. **Protocol + harness handler** (fork) + `rules-check --game fix`.
3. **Table:** snap points + read-back + change list (golden-tested on the fake TTS).
4. **Bridge:** votes, pause, apply.
5. **Live test with 2 people.**

## 10. What it still can't fix

Continuous effects "until end of turn", delayed triggers, copy effects, the stack, and hidden library order beyond
top/bottom. For those: rewind (M4.5) and replay.

## 11. As built (2026-10-23)

Differences from the plan above:
- **Ops are flat**: `{ op: "move", card, zone, position? }` (not `to: {...}`), players by slot after the bridge maps
  colours. `createToken { script, player, tapped }` takes a Forge token script (the bridge maps typed names). Each apply carries a `fixId`; the engine answers in `gameView.stateFix`
  (`{ fixId, applied, message? }`), which is how the bridge learns of a refusal.
- **No snap points**: the table reads each touched card's area with `dropArea` (playmat, graveyard, library, exile spot,
  command labels) and the two hand zones. Only cards someone picked up, turned, flipped or took out of a pile count;
  a card in no area blocks Done. Cards dropped on a pile or the library pop back out and lie there.
- **Numbers by chat** during editing: `mtg fix life <colour> <n>`, `mtg fix poison <colour> <n>`,
  `mtg fix counters <kind> <n>` on the card under the pointer.
- **Pause**: from the call on, the bridge holds the first priority question that comes with an empty stack (any
  human seat) and doesn't answer it; the engine waits there. vs AI both votes pass at once.
- Engine side: `ManaBrewInteractiveSession.applyState` (harness). Triggers are suppressed while the list is applied,
  then state-based actions run once; a restore point from before the fix is added when restore points are on.

- **From the table** (added later the same day): attach by dropping onto the permanent, right-click for the library's top or bottom, the table's life and commander-damage counters (unlocked while editing, read at Done), `mtg fix token`. The relay is our build too: the stock one drops `applyState` as an unauthorized envelope.

## 12. Fix from hand: engine-UI options instead of moving cards (spec and built 2026-11-05)

Asked for by the user 2026-11-05. Example: a phase-out that should have happened and didn't. Today the only fix is to
drag cards around. Instead, the fix panel in the engine UI offers **actions on the cards in your hand**, and nobody
moves a card by hand.

### 12.1 What the player sees

The call is unchanged: "Manual fix…" (or `mtg fix`), then the vote. Once the vote passes, the fix panel asks which kind
of fix:
- **Fix from hand** (new): table cards stay locked, as in normal play.
- **Edit the board**: today's mode (§11).

In **Fix from hand**, each player's panel lists **their own hand** (others' hands stay hidden). Every card has buttons:

| Button | What it does | Shown when |
|---|---|---|
| **Cast free** | Casts the card as if its mana were paid and its conditions met: no mana, no timing check (sorcery speed, "only during combat"), no "cast only if" check. Targets, modes and X are still asked for as usual. It goes on the stack and resolves normally, triggers included. | the card has a spell |
| **Activate free** | The same for an ability that works from the hand: cycling, channel, ninjutsu, forecast, a hand-zone ability. A list if there is more than one. | the card has a hand ability |
| **Play land** | Puts the land onto the battlefield as a land play, without counting against the land drop. | a land card |
| **To graveyard** | Puts the card into its owner's graveyard with no effect and no triggers. This stands for an interaction the engine got wrong, for example a counterspell or instant whose effect is fixed some other way, or a card that should already have been discarded. | always |

The panel also has an optional **note** box: "what should have happened" (one line, up to 200 characters). Chat
works too: `mtg fix note <text>`.

**Example:** Teferi's Protection should have phased White's permanents out, but the engine didn't. White presses
**Cast free** on the copy in hand, so the spell is cast and resolves now. The note reads "Teferi's Protection should
have resolved before Blasphemous Act".

### 12.2 Review and vote

- Each pick is added to the change list as a line:
  - "White casts Teferi's Protection for free"
  - "Blue activates Fabled Passage's … for free"
  - "Red puts Counterspell into their graveyard (no effect)"
  - plus "Note (White): …".
- **Done** shows the list to everyone, and the same vote rule applies (§5 step 5).
- A pick can be removed before Done. The order of the list is the order things happen, and the player can move a
  line up or down.
- Nothing happens before the vote passes. Picking a card only records it, so a declined vote changes nothing.

### 12.3 Apply

The bridge sends the list as `applyState` with new ops, in list order:

```json
{ "op": "freeCast", "card": "engine-card-88", "player": "player-0" }
{ "op": "freeActivate", "card": "engine-card-91", "ability": 2, "player": "player-1" }
{ "op": "freeLand", "card": "engine-card-12", "player": "player-0" }
{ "op": "move", "card": "engine-card-40", "zone": "graveyard" }
```

`move` to the graveyard is today's op: triggers are off while ops apply. The **note** isn't an op. It goes to the game
log, the bridge log and the debug log (`mtg debug` bug reports pick it up), stamped with the fix id and the seat.

**Engine side** (harness, `ManaBrewInteractiveSession.applyState`):
- First, the plain ops apply with triggers off, then state-based actions run (as today).
- After that, the free plays happen one at a time, with triggers **on**, because they stand in for real plays:
  - **`freeCast` / `freeActivate`:** follow Forge's own dev-mode "cast a spell" (`PlayerControllerHuman` dev cheats,
    `addCardToZone`):
    1. `sa.setActivatingPlayer(p)`;
    2. `sa.setCastFromPlayEffect(true)`;
    3. `PlaySpellAbility.playSaWithoutPayingManaCost(controller, sa, true)`;
    4. `game.getStack().addAllTriggeredAbilitiesToStack()`.

    The player's own controller asks for the targets, modes and X, so the usual prompts reach the table.
  - **`freeLand`:** `game.getAction().moveToPlay(card, …)` then `getTriggerHandler().runWaitingTriggers()`, as dev mode
    does for lands. It doesn't touch the land-drop count.
- The stack then resolves through the normal priority loop: everyone gets priority and can respond.
- Refusal: if a card isn't in that player's hand any more, or has no spell or ability of that kind, the whole list is
  undone and refused, as today. A target question cancelled during a free play only drops that play, and the log
  says so.

### 12.4 Limits and rules

- Only cards in the **caller's own hand**, picked by their owner. Nobody plays another player's card. Commanders in
  the command zone aren't in the list; that is "Edit the board" territory.
- "Free" means mana and timing only. Additional costs that aren't mana (sacrifice, discard, pay life) are still asked
  for, because they change the board. The vote is what decides whether that was fair.
- Commander tax doesn't count up for a free cast, because `castFromPlayEffect` casts aren't "from the command zone".
- Rewind (M4.5) can undo the whole fix: the restore point from before the fix still comes first.

### 12.5 Tests to add when built

- **Golden (bridge):**
  - the kind question;
  - the hand list shows only your own hand;
  - picks are recorded but nothing is sent before the vote;
  - list order is kept;
  - the note goes to the log and not into the ops;
  - a declined vote changes nothing.
- **Headless (`rules-check --game fix`):**
  - `freeCast` of a sorcery on an opponent's turn resolves;
  - a target question reaches the caster;
  - a resolving free spell's trigger fires (prowess as the witness);
  - `freeLand` leaves the land drop unused;
  - `move` to the graveyard fires no "dies"/"put into a graveyard" trigger;
  - a missing card refuses the whole list.
- **Live:** the Teferi's Protection example above with 2 people.
