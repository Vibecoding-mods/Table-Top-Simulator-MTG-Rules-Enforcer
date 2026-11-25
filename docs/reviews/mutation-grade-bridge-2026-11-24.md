# Mutation grade: the bridge and its modules (2026-11-24)

How well the bridge's tests catch realistic mistakes, measured on main 517ce40. A mutant is one small realistic change
to the code: truthiness in place of `!= null`, `>=` in place of `>`, `&&` in place of `||`, a default moved, side
effects in another order, a dropped `String()` or `toLowerCase()`, arguments swapped, a catch made wider. A mutant
"escapes" when every gate still passes with it in place. The grades: under 25% escaped is SOUND, 25% or more is WEAK,
and 0% is suspicious, which means checking that the mutants really differ from one another.

The grade counts a mutant as equivalent only when an argument shows that no input can tell it apart from the real
code. The argument is written into the mutant's name as `[equivalent: why]`, and those mutants are left out of the
rate.

## tools/mutate-bridge.js (bridge/bridge.js)

### What changed in the tool

- **A stale mutation is now a failure of the tool.** Before, a mutation whose code was no longer in bridge.js was
  skipped without a word. Now `--check` lists every one and exits 2, and the full run will not start.
- **45 stale mutations were repaired** to match today's code.
- **About 108 mutations were added** for code written since 2026-11-18:
  - formats: `fm`, 21 mutations
  - the trigger loop: `tl`, 36
  - Repeat xN: `rp`, 6
  - Taxes: `tx`, 12
  - the exile link: `el`, 21. These cover exileLinkMatters, EXILE_LINK_WORDS and exiledWithNote.
- **The gates.** The early-exit golden child runs first. A mutant it misses then goes through every
  `test_bridge_*.js`, cheapest first, and then the table-side tests that load the bridge. The first test that fails
  is recorded.
- **Pristine checks.** The tool checks bridge.js by sha256 before and after every mutant.

### Grades

| | mutants | golden master alone | all bridge gates |
|---|---|---|---|
| **Before** (first full run) | 315 (310 counted) | 91 escaped (29.4%), **WEAK** | 28 escaped (9.0%), **SOUND** |
| **After** | 315 (310 counted) | 90 escaped (29.0%), **WEAK** | 0 escaped (0.0%), **suspicious** |

- The first full run had 33 escapes among 315 mutants (10.5%). 5 of those are equivalent and left out, which gives
  the 28 of 310 above.
- One more mutant, "el words: hideaway dropped", ran after its new check had been written. Without that check it
  would have escaped too, so the true before figure is 29 of 310 (9.4%).

**Why 0% after is not suspicious here.** The mutants were not all caught by one thing:

- 220 were caught by the golden master.
- The rest were caught by 17 different test files.
- Each of the 28 escapes was closed by its own named check.
- Each of those checks was then re-run against its mutant and seen to fail by name.

**Why the golden alone stays WEAK.** The golden master records the bridge's messages for fixed scenarios. The newest
features are mostly not in those scenarios: all 75 formats, trigger loop, Repeat and Taxes mutants pass it.
They are caught by their own tests instead.

### Closed: 28 escapes, each now failing by name

**Trigger loop** (`tests/test_bridge_trigger_loop.js`, "edges: ..." checks):

| mutant | the check that now catches it |
|---|---|
| another player's triggers in the loop | another player's trigger is not named in the loop |
| a No (0) counts as accepted | after White's No, the run goes on for Blue |
| end: panels left up | the end of the run clears White's waiting panel |
| pick: a blank or 0 answer read as No | `__tl:0` is not a No |
| panel shown again after a No | after a No, White's panel is cleared |
| offer: How many 1 refused | How many… 1 runs it once |
| own: every → some | a kept two-target answer with one target gone is asked |
| keep: the bridge's own buttons kept | a Cancel is never given again by the run |
| passes: a No seat passed too | after a No, White is asked even on the pass under way |
| passes: the controller's own priority asked | the controller's priority is passed in the run, even while holding |
| passes: any item on top passes | with a spell from before the run on top, White is asked |
| game end: the run not said | GameAborted says the run's count |

**Repeat xN** (`tests/test_bridge_repeat_loop.js`):

| mutant | the check that now catches it |
|---|---|
| a manual fix doesn't stop it | stop a manual fix |

**Taxes** (`tests/test_bridge_tax_auto.js`):

| mutant | the check that now catches it |
|---|---|
| No still auto-pays the next payment | never pay: a later payment is shown |
| a question for a controlled player answered | controlled player: the question is shown |
| the payment matched by card AND name | a payment with only the card id is auto-paid |
| a pay-for ("If you do") counted as a tax | pay-for: shown |
| the controller read from the prompt first | stolen Tithe: shown |

**Formats** (`tests/test_bridge_standard.js`):

| mutant | the check that now catches it |
|---|---|
| modeOf: case not folded | the mode's case and spaces are folded |
| modeWords: one player called 1v1 | one player in Standard is just Standard |
| onFormat: AI seats said at every format change | a change within the same mode doesn't say them again |
| onFormat: the table not marked as having formats | after a format message, a refresh sends the ban list |
| aiSeatsOffMode: a deck without a format read as Standard | a deck with no format is a Commander deck |

**Manual fix:**

| mutant | the check that now catches it |
|---|---|
| partner at the same damage lowered too | `tests/test_bridge_claims.js`, "cmd damage: lowered to 10" |
| watchdog off the tick | `tests/test_fix_hand_relations.js`, "R12 the 5-second tick runs the fix watchdog" |

The harness never runs `setInterval`, so the watchdog check reads the bridge's source instead. It reads it through
`BRIDGE_PATH`, as R12 already does.

**Exile link** (`tests/test_bridge_exile_link.js`):

| mutant | the check that now catches it |
|---|---|
| words: imprint dropped | Isochron Scepter |
| words: hideaway dropped | a bare Hideaway keyword |
| words: "exiled with" dropped | "exiled with" alone |

**Labels** (the golden master):

| mutant | the check that now catches it |
|---|---|
| same mana told apart dropped | new scenario "tapmana: the same mana two ways, told apart (not by its damage)" |

The golden was recaptured with `tools/capture_bridge_golden.js`. It went from 1096 to 1097 scenarios: one was added,
none were removed and none changed.

### Equivalent: 5 mutants, left out of the rate

- **attack: `??=` → `=`.** Before that line, only a must-attack entry is set, and it is set to the same value. All is
  not chosen when a creature must attack.
- **fm refresh: Standard cache kept.** Every format cache key carries the list's hash. The no-format Standard path
  reads no legality data.
- **tx button: the open question closed as not answered.** closePrompt's `answered` flag only gives back an askUnder
  card, and a tax question is never an askUnder.
- **tl panel number: NaN kept.** Every reader of `acc` tests `> 0` or `in`, so NaN and negative numbers act as 0, and
  the chat line is the same.
- **tx `!= null` → truthiness on the controller.** Controller ids are always "player-N" strings, never "" or 0.

### Uncatchable

None.

## The other bridge modules

### tools/mutate-bridge-modules.js (new)

This tool adds new mutations for three modules:

- bridge/teams.js: 24 mutations
- bridge/format-rules.js: 18
- bridge/legality.js: 20

It keeps a pristine copy aside, checks sha256 before and after each mutant, runs a baseline first, and exits 2 when
a mutation is stale.

| module | before | after |
|---|---|---|
| teams.js | 4 of 21 escaped (19.0%), **SOUND** | 0 of 20 (0%), 4 equivalent |
| format-rules.js | 4 of 18 escaped (22.2%), **SOUND** | 0 of 18 (0%) |
| legality.js | 6 of 20 escaped (30.0%), **WEAK** | 0 of 20 (0%) |

**Closed:**

- **teams.js** (`tests/test_bridge_teams.js`):
  - juggOf's highest limits
  - archOf with the first colour of the list
  - no winners before the game is over
- **format-rules.js** (`tests/test_bridge_formats.js`):
  - few() with exactly 8 names
  - a card's own limit counts the main deck only
  - a name the data returns nothing for is said as not checked
  - a Pauper Commander commander that is also in the 99
- **legality.js** (`tests/test_bridge_legality_refresh.js`):
  - a check exactly a day later
  - a list exactly a week old
  - a format whose key the data dropped
  - a download one card shorter than the cache is taken
  - a check that a game cut short runs again
  - the download's own 429 waits an hour

**Equivalent** (teams.js):

- teamModeOf, hasOwnProperty → truthiness: the table sends only the five mode names.
- teamModeProblem, `== null` → truthiness: gameMode is null or a non-empty string.
- turnPlayerIds, `== null` → truthiness: team numbers are 1 and 2.
- withTeamDamage, Number() dropped: Forge sends commander damage as JSON numbers.

### The five existing module tools (run through tmp/slot.js)

| tool | before | after |
|---|---|---|
| mutate-teams.js | 6 of 25 "survived", **all 6 stale** (24%, WEAK) | 25 of 25 caught |
| mutate-team-modes.js | 7 of 51 "survived", **all 7 stale** (13.7%) | 51 of 51 caught |
| mutate-format-rules.js | 59 of 59 caught | unchanged |
| mutate-legality.js | 48 of 49 caught (2.0%, SOUND) | unchanged; the miss is equivalent |
| mutate-engine-build-record.js | 12 of 12 caught | unchanged |

- **mutate-teams.js and mutate-team-modes.js.** These two tools count a stale mutation as survived. Their 13 stale
  mutations now match today's code.
- **mutate-format-rules.js.** Its first run showed 11 "survived". That was a clash: it writes its bridge copy to the
  same path (`bridge/bridge.mutant.js`) as mutate-bridge.js, which was running at the same time and deleted the copy.
  The rerun alone caught all 59.
- **mutate-legality.js.** Its one miss, "hello's own format not used", is equivalent. The hello handler calls
  noteMode(m) just before it, which sets gameMode.format from the same field, and banlistFormat() falls back to that.
  The table sends format keys only.

The two tools share `bridge/bridge.mutant.js`. Run them one at a time, not side by side.
