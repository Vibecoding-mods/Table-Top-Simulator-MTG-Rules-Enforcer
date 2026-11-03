# Spec: our own copy of the rules, in Lua inside Tabletop Simulator

Status: written 2026-11-02, then built the same day as an experiment on the `copy-engine` branch (worktree
`../mtg-tts-copy-engine`, folder `engine-lua/`). What the build found, the comparison with this build and the next test are
on that branch: `docs/spec-own-engine.md`, `docs/compare-current-vs-copy.md`, `docs/engine-compare-map.html`. Numbers
marked *measured* were taken that day from the Forge copy in `manabrew/forge` (Manabrew snapshot fd16e2f, 2026-10-16) and
from TTS's own Lua interpreter.

## Why the copy engine exists, and what it hasn't proved yet

**The user's reason (2026-11-02): big fixes should be easier and better.** In this build a deep bug can need changes in
up to four places (Forge or the harness in Java, a new image build, the bridge in JS, the table in Lua, then a save
patch), and the bridge only sees Forge through board snapshots, so it has to guess what happened. The copy engine was
meant to put the rules and the table in one place, where the table calls the engine's own functions and a fix is made
once.

**Not proved yet.** The build so far proved only that Forge translates and plays a game in Lua; speed was the measured
part. No bug has been fixed in both builds and compared. The test that would prove it, or not, is to take the same bugs
(phasing shown as gone, the rewind race, Kardur's must-attack, Bloodline Keeper leaving target lists) to both builds and
record, for each: where the fix lives, how many files and languages it touched, the rebuild and redeploy time, and
whether it changed Forge's own code. Until then, "fixes are easier in the copy" is the hope, not a finding.

## TLDR

- **Can it be done?** Probably yes for games between people. The rules code is about 156,000 lines of Java, and its Java
  is plain enough to translate by machine. The unknown is speed: Lua inside TTS runs on one thread on the host's PC, and
  nobody has measured a Forge-sized engine there. So the first step is a small test that can kill the idea cheaply.
- **How:** don't hand-write a Lua Forge. Write a translator that turns Forge's Java into Lua, one file for one file, same
  names, same logic. Card scripts are copied unchanged. A new Forge version then means running the translator again, which
  is what keeps it updatable. Hand-written code stays small and in named places.
- **What you get:** no Docker, no bridge, no relay, no server to host. Friends join the TTS game and it just works.
- **What you pay:** a slower engine, TTS pauses on the host when a board gets big, and the AI comes last or not at all.
- **Next step, when you want it:** Phase 0, about one sitting of work, on a table with no game running.

## What was asked, and how each part is met

| You said | How this spec does it |
|---|---|
| Drop the bridge and Forge | The engine runs in the table's Lua. Bridge duties are split up in "What replaces the bridge" |
| Works in Lua/Unity | Lua inside TTS. TTS mods can't load C#, so "Unity" isn't open to us without leaving TTS |
| Can be updated from the original Forge | Re-run the translator on the new Forge, copy the new card scripts |
| Drift is okay if it works | Allowed, and written down: every difference is a small patch file with a reason |
| We understand the core code | Output keeps Forge's names and shape, and the 14 core files get a plain-English walkthrough |
| No super functions or files | One Lua file per Java file, enforced by a test, with a cap on hand-written code |

## Where it would run

TTS gives a mod exactly one place to run code: Lua on the host, in MoonSharp, a Lua interpreter written in C#. There is
no C#, no threads and no native code for mods. A standalone Unity app could run C#, but that means leaving TTS, which is
this project's required front end, and rebuilding the whole table. So this spec means MoonSharp in the table's Global
script. Only the host's PC does the rules work. Other players' TTS just shows the result, as it does now.

## Measured facts

| What | Number |
|---|---|
| Rules code: forge-game | 811 files, 127,738 lines of Java |
| Base code: forge-core | 152 files, 27,070 lines |
| AI: forge-ai | 191 files, 57,257 lines |
| Card scripts | 33,977 files, 23.6 MB, 727 bytes each on average |
| Effect verbs in scripts | 192; 42 of them cover 90% of uses, 114 cover 99% |
| Biggest files | Card 8,136; CardFactoryUtil 4,148; Player 4,100; AbilityUtils 3,967; GameAction 2,960 |
| Manabrew's Rust port, for scale | 155,419 lines, and its own docs still call it incomplete |
| Java features, forge-core + forge-game | 860 lambdas, 371 stream calls, 74 enums, 858 inner classes, 18 uses of reflection, 38 uses of threads |
| Outside libraries | Guava in 430 files, Apache Commons in 176 |

TTS's own `MoonSharp.Interpreter.dll`, timed under .NET 8 on this PC while tests were also running. **Not yet timed inside
TTS** (TTS was hung that evening), where it runs under Unity and is likely slower. `tools/moonsharp-bench.lua` is the test.

| Operation | Per millisecond |
|---|---|
| Plain loop step | 6,300 |
| Function call | 2,000 |
| Method call through a class | 2,100 |
| Table field read and write | 2,700 |
| New small table | 1,000 |
| Pattern match on a card script line | 229 |
| Compile 12,000 lines (266 KB) | 112 ms |
| Compile 240,000 lines (5.4 MB) | 2.1 s |

What that means: compiling is not the problem. Running might be. At about 2,000 calls per millisecond, a TTS frame (16 ms)
holds about 30,000 calls on this measure. My estimate, not a measurement: one pass of state-based actions and continuous
effects on a late Commander board could take 50,000 to 100,000 calls, so 25 to 50 ms here, and perhaps 100 to 250 ms inside
TTS. That's a visible hitch at each priority pass unless the work is spread over frames, and Phase 0 replaces this guess
with a number.

## Three ways to do it

| | Hand port to Lua | Translate the Java by machine | Keep Java, drop only the bridge |
|---|---|---|---|
| Work | 150,000+ lines by hand | One translator plus a small runtime | Small |
| After a Forge update | Re-read every change by hand | Re-run it, fix what the parity test finds | Nothing |
| Drift over time | Grows without limit | Stays at the patch list | None |
| Drops Docker and hosting | Yes | Yes | No |
| Matches "no super functions" | Depends on discipline | By construction | Yes |

Choice: **translate by machine.** Manabrew shows what the hand route costs: 155,000 lines of Rust and still chasing
parity. Its rule of "same file names, same symbol names, same control flow" is the right rule, and a translator keeps
that rule for free. A translated file is also honest about where it came from, so reading it teaches the Java.

Rust to Lua isn't an option: TTS can't run WASM, and the port is incomplete anyway.

## Layout

```
engine-lua/
  forge-pin.txt       the Forge commit we are built from
  translator/         Java -> Lua. Ours. Node script on a real Java parser
  runtime/            the hand-written part: one file per Java class it stands for
  patches/            our drift: small diffs on translated output, each with a reason
  out/                generated. Never edited by hand. One .lua per .java, same path and name
  DRIFT.md            every patch and every left-out package, in a line or two
tools/forge-sync.js   the update command
tests/parity/         the same games on Java Forge and on the Lua engine
```

The table's script keeps what it has now (`engine-renderer.lua`, the map, the check) and calls the engine instead of
the bridge.

## The translator

Input is Forge's Java, output is plain Lua that a person can read beside the Java. It keeps method names, argument order,
branch order and local variable names, and drops nothing but type names. What it has to handle, from the scan above:

| Java | Lua |
|---|---|
| Class, inheritance, interface default methods | A table with a metatable; methods copied or chained |
| Overloads (458 names in the scan) | Name plus argument count or type: `addCounter_3`. Stable, and listed in a generated map |
| Inner and anonymous classes | Closures or small local classes |
| Lambdas and method references | Lua functions |
| Streams | Plain loops, or the `Stream` shim in `runtime/` |
| Enums | Tables of frozen objects, with `ordinal` and `name` |
| `int` and `long` maths | Lua has only doubles: `/` on ints becomes truncation, `%` keeps Java's sign, overflow only where a hash needs it |
| `switch`, labelled `break`, `continue` | `if` chains, plus `goto` if MoonSharp has it (a Phase 0 check), flags if not |
| Exceptions | `error` and `pcall`; only 116 catch sites |
| Reflection (18 uses) | Generated lookup tables, e.g. effect verb to class |
| Threads (38 uses) | Left out: the game loop becomes one coroutine |
| `String.format`, regexes (862 uses) | Shims. A Java regex that Lua patterns can't express gets a hand-written matcher in `runtime/` |

**The 200-locals limit** that bites `engine-renderer.lua` doesn't apply: each file is its own chunk and returns one table.

## The runtime: the only hand-written engine code

One Lua file per Java class it stands in for: `ArrayList`, `HashMap`, `TreeMap`, `Iterables`, `Lists`, `Multimap`,
`StringUtils`, `Random` and so on. Rules:

- Nothing in `runtime/` knows anything about Magic.
- Each file does what the Java class does, nothing more, and has the same method names.
- **Cap: 8,000 lines in total.** Going over means something belongs in the translator.
- `java.util.Random` is reproduced exactly (its 48-bit maths has to be split across doubles), or parity tests can't work.
- `List.sort` is a stable Lua merge sort: Java's is stable and `table.sort` isn't, and a yield can't cross into `table.sort`.
- `HashMap` iteration order is the known hard one: rules code that loops over a `HashMap` depends on Java's hash order.
  Plan: reproduce `String.hashCode` and Java's bucket order for the maps where parity finds it matters, insertion order
  everywhere else, and list each one in `DRIFT.md`.

## What stays out of the engine

Left out, listed in `DRIFT.md`: forge-gui, adventure mode, limited and draft, net play, Sentry reporting, `CardView` and the
view layer (the table reads the engine's objects directly), and localisation beyond English. Every other forge-game file
stays, including ones no deck uses today, so that the one-to-one rule stays simple.

## Card scripts

Copied byte for byte from Forge, never edited. Parsed by the translated `CardFactory` code, so our parser is Forge's parser.

They can't all live in the save (23.6 MB). A game needs only its decks: at most 400 cards, about 290 KB. At deck import the host
fetches each script from Forge's public repository at the pinned commit, by TTS's WebRequest, and keeps them in the save for
next time. An engine update changes the pin. Whether TTS is happy with that many requests is a Phase 0 question; if not, a
single file per deck.

## Speed plan

- **The engine is one coroutine** started by `startLuaCoroutine`. This replaces Forge's game thread. Where Java blocks
  waiting for a player, the coroutine yields until the table has an answer. That fits Forge's shape well.
- **A time budget:** the translator puts a budget check at loop heads in hot files, and past 8 ms the coroutine yields to the next
  frame. Nobody else touches the game state, so yielding in the middle of a rules action is safe.
- **Lazy loading:** each `out/` file is compiled on first use. A game touches maybe 60 of the 206 effect files.
- **Caching is allowed drift:** Manabrew's rule applies. Anything that can't change a result may differ from Java.
- Long waits show on the table as a small "thinking" mark, as a slow AI does now.

### Speed pass: go through the entire code base and remake it for speed (requested 2026-11-02)

The first whole game on MoonSharp (2026-11-02, two Forge AIs, simple decks) plays correctly but slowly: set up 0.8 s and
63 MB, then about 5 s per turn, with single AI decisions up to 3.5 s. Those runs had debug tracing on, which costs some of
that. Java Forge has not yet been timed on the same game; it is expected in milliseconds. Before this way is chosen, every
part of the code gets a speed pass:

- **Profile first, then rewrite.** Count calls and time per function over whole games and fix the top of the list,
  repeating until a turn fits the frame budget above. No guessing at hot spots.
- **The translator's output, file by file:** overloads named at translate time instead of checked at run time (each
  call now tests every argument's type), plain numeric `for` loops instead of iterator objects over lists, streams turned
  into loops, `try` blocks without a closure where nothing can throw, string building without a builder object.
- **The runtime:** collections on plain Lua tables with no extra layer, hashing and equality short-cuts, fewer
  tables made per call.
- **Forge's own hot paths,** chiefly the AI: combat simulation, card copies for "last known information", and checking
  every ability of every card again and again. These are the parts Java runs fast and an interpreter doesn't.
- **The rule that limits it:** a speed change goes in the translator or runtime wherever it can, so the next Forge update
  re-translates with it. A hand rewrite of a Forge file is one more file to redo on every update (see "Updating from the
  original Forge"), so each one is listed in DRIFT.md with the time it saves; if those grow past the 5% patch limit, that
  is a stop test for this way.

## What replaces the bridge

| The bridge's job today | After |
|---|---|
| Talking to Forge, the relay, Docker | Gone |
| Turning Forge's prompts into table questions | Moves to Lua, and gets simpler: it reads Forge's own objects |
| The game log (`logEvents`, boards compared) | Moves to Lua, reads the engine's events directly. All the guessing goes |
| Sending boards to the table | Gone: the renderer reads the engine's state and draws what changed |
| Card pictures from Scryfall | Moves to Lua through WebRequest |
| Deck import and presets | Moves to Lua |
| Saving a game to resume | `GameState` (translated) into the save, as whole-number lists and text: TTS's `JSON.encode` freezes on tables keyed by fractional numbers |
| Rewind, manual fix | Same `GameState` route as today's `applyState` |
| Debug port, /exec | Kept for development only, as a small optional tool |

Roughly 5,500 lines of `bridge.js` shrink to the part that is table logic rather than plumbing, and `table-map.js` stays as
it is. Its point gets stronger: the map becomes engine objects to table, with nothing in between.

## Updating from the original Forge

`node tools/forge-sync.js <commit>`:

1. Check out that Forge commit, and diff it against `forge-pin.txt`.
2. Re-run the translator on every changed file. New card scripts come along by moving the pin.
3. Re-apply `patches/`. A patch that no longer fits stops the run and names itself.
4. Run the parity suite against Java Forge at the same commit. Differences list as work.
5. If green, move the pin. If not, the old pin stays live: nothing has to ship the day Forge changes.

A new set usually means new card scripts, and now and then a new effect or keyword. Scripts need nothing. A new Java file
translates like the rest. The one thing that needs a person is new Java syntax or a new library call: the translator stops and
says so.

## How we keep to "no super functions"

A test in the style of `tests/test_table_map.js`, failing by name when:

- an `out/` file has no matching Java file, or a Java file has neither an `out/` file nor a `DRIFT.md` line
- a method in the Java is missing from its Lua file
- `out/` differs from what the translator produces from the pin (a hand edit)
- `runtime/` passes its line cap, or a runtime file mentions a Card, Player or Game
- a patch has no reason, or is over 40 changed lines

## Understanding the core

Translated code is readable, but 150,000 lines doesn't get read. These 14 files are the rules: `Game`, `GameAction`,
`phase/PhaseHandler`, `zone/MagicStack`, `spellability/SpellAbility`, `card/Card`, `card/CardFactoryUtil`,
`ability/AbilityUtils`, `trigger/TriggerHandler`, `replacement/ReplacementHandler`,
`staticability/StaticAbilityContinuous`, `combat/Combat`, `cost/CostPayment`, `player/Player`. Each gets a plain-English
page in `docs/engine/`: what it owns, its order of operations, what it calls. A mechanic bug starts from those pages.

## Testing

- **Parity:** same decks, same seed, same choices, on Java Forge and on Lua, compared state by state after each action. Manabrew
  has built this for Rust (`manabrew-rs/crates/parity`, 21,129 lines, with its `regression.json` and an ignore list for Java's
  own bugs). We keep Java Forge in Docker as the oracle, for testing only. Players never need it.
- **Everything we already have still counts:** the 27 hand-test decks, the golden tables, the table check, and the rules
  scenarios all run the same on the new engine, and that's what shows it's playable.
- **Lua runs in the test harness too:** `tests/lua/tts-sim.lua` runs on fengari in Node. Parity should run there for speed, with a
  smaller suite on real MoonSharp, since the two differ (`moonsharp-loop-var-bug` is one example).

## Phases

Each phase has a stop test. If it fails, we stop, having spent only that phase.

**Phase 0: can it run?** (one sitting, no translator)
- `tools/moonsharp-bench.lua` inside real TTS: how much slower than .NET 8?
- A 5 MB script through `load`, and in the save. Does the save still open and stay fast?
- 1,000 hand-built Card-sized tables in Lua: memory and speed of a layers-style pass over 80 permanents.
- Coroutine yields through `pcall`, metatables and `goto`, on MoonSharp.
- 100 WebRequests to raw.githubusercontent.com at once.
- **Stop if** the estimated state-pass on a big board is over 1 second, or a big script won't load.

**Phase 1: translator on forge-core.** 27,000 lines, no rules, plenty of Java. The runtime grows here.
- **Stop if** the runtime passes its cap, or more than 5% of files need hand patches.

**Phase 2: a game with no prompts.** forge-game translated, two decks of vanilla creatures and lands, seeded,
auto-choices, played to the end against Java.
- **Stop if** a turn on a modest board takes over 5 seconds.

**Phase 3: parity.** The 14 core files first, then effects in order of use: 42 verbs cover 90% of the scripts.
- **Done when** the parity suite passes for the 27 hand-test decks.

**Phase 4: on the table.** Renderer and prompts on the Lua engine, behind a switch, with Forge still there to fall back to. The
bridge stays until this phase has been played for real by four people.
- **Stop if** the group finds it worse to play than the bridge version. Slower is acceptable; wrong or frozen isn't.

**Phase 5: drop the bridge.** Docker stack and bridge retire. The save is published.

**Phase 6, optional: the AI.** forge-ai through the same translator, 57,000 lines, with the same coroutine. Not needed for games
between friends. Until then, AI seats need the Java version, so the two would live side by side.

## Risks

- **Speed on big boards.** The biggest risk, and why Phase 0 exists. Commander late-game boards are the worst case for a slow
  interpreter.
- **Slow pauses on the host only.** During a heavy pass, the host's TTS stalls in small steps. Budgeting helps; it doesn't
  remove it.
- **HashMap order and floating-point details.** Small differences from Java turn up as parity failures that are slow to trace.
- **Memory.** MoonSharp values are heavier than Java's. 400 cards with their abilities, triggers and history could reach
  hundreds of MB. Phase 0 gives a figure.
- **Reload during a game.** A coroutine doesn't survive a table reload. Resume has to go through `GameState`, a reload can
  land in the middle of an action, and it would rewind to the last priority point.
- **Upstream refactors.** A large Java rewrite passes through unchanged, but patches can stop fitting, which is why they stay few.
- **TTS script limits nobody has tested.** The 60 KB XML limit bit this project already. Nothing says script size has none.
- **Two engines during the change.** Phases 3 and 4 mean supporting both. The table map is what keeps that sane.
- **Size.** This is a large project, and it competes with everything else on the list.

## Licence

Forge is GPL-3.0-or-later, so translated code and card scripts are derivative and must stay GPL, with Forge credited.
Manabrew is AGPL-3.0-or-later: anything taken from Manabrew's code, parity harness included, carries AGPL. The cleanest split
is a translator of our own (ours to license, but its output GPL), and parity tooling kept out of what gets published on the
Workshop. Worth one more look before going public, alongside the message to the table's author. This is a reading of the
licence files, not legal advice.

## Not decided here

- Whether to start. This spec is the case for and against; Phase 0 is cheap, the rest isn't.
- 6-player: nothing here blocks it or helps it. The engine doesn't care about seats; the UI does.
