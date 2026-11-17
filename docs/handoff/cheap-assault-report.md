# Report: a smarter cheap assault past the combat deadline

Cloud session, 2026-11-17, branch `cloud/cheap-assault`, from `origin/cloud/ai-budgets` (`0bb4d3d`). Engine tag
`engine1117-cheapassault`, on top of `engine1117-aibudgets`. It merges with `cloud/owner-decisions-1117` into
engine1123. Not built as an image.

## What changed

`AiAttackController.cheapAssault`, the answer `doAssault` gives past the combat deadline, now reads trample, menace,
evasion, double strike and creatures that can't block. It still makes no attacker × blocker check: it uses sorts and
bins, O(attackers + blockers).

**Blockers.** Each is read once.

- One that can't block (`CombatUtil.canBlock`) is no blocker.
- The rest are counted in bins by what limits whom they can block: flying or reach, shadow, horsemanship, colours.
- Their toughness, extra blocks included, is sorted.

**Attackers.** Each is read once.

- **Unblocked** when:
  - no counted bin could block it: flying with no flying or reach blocker; shadow or horsemanship with no blocker that
    has it; protection from the colours of every blocker there;
  - a "can't be blocked" static with no blocker condition holds for it (Phantom Warrior);
  - or it assigns its damage as unblocked.
- **Read once per assault from the game's static abilities.** Forge's `CombatUtil.canBeBlocked(a, null, defender)`
  calls `applyCantBlockByAbility` with no blocker, which always answers "can be blocked". That is how Phantom Warrior
  first counted as blockable; the tests caught it (see below).
- **Double strike** counts twice. **Infect** counts nothing toward life.
- **Trample:**
  - A blocked trampler deals what is past its blocker's toughness.
  - The biggest tramplers take the toughest blockers. That pairing lets the least through: the excess is convex, so
    matching both sorted is the minimum over all pairings.
  - A menace trampler is held by the two toughest blockers, whatever else they hold.
- **Menace** takes two blocks.

**The defender's blocks.**

- They go where they stop the most damage per block: ground blocks to ground attackers first, then flying or reach
  blocks to any.
- A menace attacker may take half a block, stopping half its damage rounded up.
- That is at least what the defender could really stop. So "lethal" is said only when no blocking stops it: never a
  reckless all-in.

**Not counted (each errs on not attacking).**

- Deathtouch, first strike against the blockers, lifelink.
- Fear, intimidate, skulk.
- Protection from a quality other than colour.
- "Can't be blocked by" rules with a blocker condition (Juggernaut's Walls), and landwalk.

**Counters for the tests:** `getCheapAssaultsLethal()` and `getCheapAssaultsSafe()`.

## Tests

`BigBoardFixesTest`: 22 → 32 checks, all passing. Each cheap-assault check reads the estimate's counters and the
assault-check counter (zero past the deadline), never timing. Where the estimate says lethal, every attacker must go at
the defender.

| Check | Lethal board | Not lethal |
|---|---|---|
| trample | 3 Dreadmaws into 3 Craw Wurms, 6 life; into toughness 10, 4, 4 at 4 life | 7 life; 10/4/4 at 5 life; Dreadmaw and War Mammoth into toughness 10 and 2 at 2 life |
| menace | 2 Boggart Brutes, 1 blocker, 4 life | 2 blockers, 4 life; 1 blocker, 5 life; a Brute and 2 Bears into 2 blockers, 4 life |
| evasion | Phantom Warrior, Dauthi Slayer, White Knight and a Hill Giant into 3 black blockers, 6 life | 7 life; 3 Juggernauts into non-Walls |
| protection, other colour | — | 3 White Knights into green blockers |
| double strike | 4 Fencing Aces, 1 blocker, 6 life | 7 life |
| can't block | 3 Hill Giants into 3 Bog Hoodlums, 9 life | one that can block, 9 life |
| infect | — | 3 Glistener Elves, no blockers, 2 life |
| reach | 3 Wind Drakes into 2 Giant Spiders, 2 life; flyers and Hill Giants into a Spider and 6 Hill Giants, 4 life | 4 life |
| 6 × 120 | 60 Dreadmaws and 60 Phantom Warriors into 120 Craw Wurms, 20 life (all 120 attack); 10 Phantom Warriors and 110 Hill Giants (all attack) | 120 Hill Giants into 120 Craw Wurms (no assault, not all attack) |

**Found by the tests on the way:**

- **Blockers dropped before the estimate.** `getPossibleBlockers` already drops blockers that can block none of the
  attackers. The first evasion boards had no blocker left at all, so they passed without the rules being used. A Hill
  Giant is now among the attackers there, so the blockers stay.
- **Phantom Warrior counted as blockable.** This is the `canBeBlocked` quirk above, now read from the statics.
- **One very tough blocker held every trampler.** The first version charged every trampler against the toughest
  blocker. On BigBoardCheck's random board one blocker had toughness 63, so no trampler counted at all. Now the
  blockers are paired by rank.

**The full harness suite** (`engine/test-harness-local.sh --all`, rebuilt, on this branch's tree): 46 classes, all
passed.

## Break-its (each fails by name; files restored by sha256)

- **`node tools/mutate-cheap-assault.js <tree>`: 18 of 18.**
  - Trample: ignored; the toughest blocker held against every trampler; the weakest blockers on the biggest tramplers.
  - Menace: one block; half a block stopping nothing; blocks by damage instead of damage per block.
  - Evasion and protection:
    - no evasion read from the bins;
    - "can't be blocked" ignored;
    - shadow ignored;
    - protection from any colour;
    - a blocker-side rule counted as "can't be blocked";
    - every creature taken as its own rule's host;
    - the self rules not read.
  - Damage: double strike ignored; infect counted as damage.
  - Reach ignored.
  - The answer: half the life counted as lethal; always all-in.
- **Dropped as equivalent,** because nothing the tests can build tells them apart:
  - **"A creature that can't block counted":** `getPossibleBlockers` already drops such blockers before the estimate.
    The check stays in the code as a guard.
  - **"Flyers blocked by ground blockers" in the bin check:** flyers only take air blocks anyway.
  - **"A menace trampler held by one blocker":** no card has both menace and trample, except legendary or
    double-faced ones.
- **`node tools/mutate-ai-budgets.js <tree>`: 20 of 20.**
  - Its two "the cheap one always / never made" mutations were updated for the new code.
  - Its "flyers taken as ground" mutation now names the reach check. Without reach blockers, flyers are unblocked by
    the bins before that list.

## The real board: BigBoardCheck at 6 × 120

`engine/checks/BigBoardCheck.java decisions 40,120 6`, this container, after the change: **still 0 attackers** at
6 × 120 (6.0 s; ai-budgets measured 5.8 s). At 6 × 40, also 0, as before.

- This is right by the estimate, not a gap in it. The defender there has 64 possible blockers against 61 attackers:
  55 ground blocks for 53 ground attackers, and 9 air blocks for 8 flyers.
- Only one attacker has trample, and none is unblockable.
- Every attacker can be blocked, so an estimate that never says lethal when the defender could stop it can't say
  lethal.
- ai-budgets' probe found the real check calling it lethal, maybe from non-combat damage or from blocks the real
  check judges the defender wouldn't make. Neither is in a cheap, safe estimate.
- The boards in the tests show the estimate going all in where it should: tramplers past toughness 4, and unblockable
  attackers among 120.

## Patches

- `engine/forge.patch`: only `AiAttackController.java` differs from ai-budgets'.
- `engine/manabrew.patch`: only `BigBoardFixesTest.java` differs. No comments in harness Java.
- `git apply --check` is clean on fresh pins `fd16e2f` / `e7d2b93b`.
- `docs/engine-changes.md` has the table row and the section. `docs/handoff/ai-budgets-report.md`'s known-gap line
  points here.

## Not run / left

- No bridge or table code changed, so the bridge and table gates weren't rerun.
- No image was built and no live game was played.
- `getPossibleBlockers` still asks each blocker against the attackers until one can be blocked. That is pairwise in
  the worst case (a blocker that can block nothing). It runs in the constructor before any deadline check, outside
  `cheapAssault`, and wasn't in scope.
