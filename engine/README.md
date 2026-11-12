# The engine: our changes to Manabrew and Forge

The rules engine is [Forge](https://github.com/Card-Forge/forge), run through
[Manabrew](https://github.com/witchesofthehill/manabrew)'s relay and self-hosted node. This project needs changes to both,
so it can't run on the stock images. Those changes are published here:

| File | What it is |
|---|---|
| `manabrew.patch` | Our changes to Manabrew at commit `fd16e2fbaf31873cf7a8305a44911b77d277bef0` |
| `forge.patch` | Our changes to Forge at commit `e7d2b93ba9f800a1f5f3a5de91db1aad3ed46831` |
| `build-images.sh` | Fetches those exact commits, applies the patches and builds `mtg-relay` and `mtg-forge-node` |

```bash
bash engine/build-images.sh
```

## Testing a build

The harness unit tests (`MindslaverControlTest`, `ExtraTurnRewindTest`, `AttackDefenderChoiceTest` and the others under
`forge-harness/src/test/java`) run in a throwaway container. `checks/harness-tests.sh` recompiles the harness's main and
test sources from the tree you mount, against the Forge jar of a `java-builder` image, so the image only has to be rebuilt
when Forge's own Java changes, not for a new harness class or test:

```bash
# once per Forge change: the java-builder stage of the node image, from the patched tree (build-images.sh's .build)
docker build --target java-builder -f engine/.build/manabrew-rs/crates/self-hosted-node/Dockerfile -t mtg-harness-test:<tag> engine/.build
# every run (Git Bash: MSYS_NO_PATHCONV=1 and Windows paths for -v); exit status 0 when every class passed
docker run --rm -v "<tree>/forge-harness:/src:ro" -v "$PWD/engine/checks/harness-tests.sh:/harness-tests.sh:ro" \
  --entrypoint sh mtg-harness-test:<tag> /harness-tests.sh [TestClass ...]
```

The live checks play real games against a built node image, beside the running stack (`tools/live-check.sh`, which
explains its settings): `sh tools/live-check.sh <tag> tests/live_mindslaver_check.js`. The relay defaults to
`mtg-relay:<tag>`; set `LIVE_RELAY` for a node image built without one.

## Why this source is published

Forge is licensed under the **GPL-3.0** and Manabrew under the **AGPL-3.0-or-later**. Both are "copyleft" licences. They
let anyone use and change the code for free, and in exchange the changes have to stay just as open:

- **If you share a modified version** (GPL and AGPL), everyone who receives it must be able to get its full source code
  under the same licence.
- **If people use a modified version over a network** (AGPL only), they must be offered the source too, even if you never
  hand them a copy. A server running this engine for your friends counts.

Publishing a modified engine without its source would break those licences and lose the right to use the code. These
patches, together with the upstream commits they name, are that source.

## Licences in this repository

This repository has more than one licence, and they don't mix:

- **This folder's patches** are derived from Forge and Manabrew, so `forge.patch` stays under the GPL-3.0 and
  `manabrew.patch` under the AGPL-3.0-or-later. The Unlicense at the top of the repository does **not** cover them.
- **Everything else we wrote** (the bridge, the table script, the tools) talks to the engine over its network protocol as a
  separate program, and is public domain under the Unlicense.

If you run a modified engine as a public service, point your players to its source. This is a plain-English summary, not
legal advice; the licence texts are what count.

## What the patches do

- **Protocol and relay:** the exile links the table draws (`exiledWith`, `mayPlay`), the manual fix directive
  (`applyState`, `stateFix`), cost Cancel, seat order, and persistent mana for the fix tools; the fix's `draw` and
  `mill` ops (Forge's own draw and mill, made after the other changes with triggers on: the debug tools' Draw and
  Mill, `ApplyStateDrawMillTest`).
- **Forge harness:** filter-land playability, rewind zone order, Treasure ranked last in auto-pay, a stack-target
  check that no longer crashes on Spider-Sense, and undoing a mana tap also undoing what that tap triggered; a
  controlled player's questions (Mindslaver) go to the seat controlling them, up a chain of control to the last seat
  that can answer; a rewind puts the extra-turn queue back, and `extraTurnCount` counts every extra turn queued for a
  player; Mayhem (discarded this turn), Harmonize, Beam me up and plotted cards get `mayPlay`; and a Forge AI seat
  whose main deck is all lands (`ai_passive_lands`, the harmless bot) gets `PassiveLobbyPlayerAi`, which only plays
  lands: no spells, no abilities, no opening-hand cards, no attack unless the rules force one; and a creature put onto
  the battlefield attacking (Hero of Bladehold's tokens) is named in its "attack whom?" question (Forge's question as
  the description, the creature as its one target).
- **Forge card scripts:** 29 scripts that remembered cards and never cleared them, so a second use acted on old cards
  (`docs/reviews/forge-remembered-audit.md`).
- **Forge rules code:** `TriggerHandler.removeWaitingTapsForMana`, used by that undo.
- **Star Trek (TRK, TRC), 2026-11:** the two sets' card scripts, tokens, edition files and creature types from
  Card-Forge/forge `6d4a175`, plus the Java those cards need (assimilate, peace counters, and a few `Count$` and
  property names), and four script fixes from `2549d11` (2026-11-10). Every imported file is listed in `forge-trek-files.txt`; what and why in
  `docs/forge-update-2026-11.md`. `checks/` holds the headless checks used for it and
  `harness-tests.sh`, the unit-test runner above.
