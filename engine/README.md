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
  (`applyState`, `stateFix`), cost Cancel, seat order, and persistent mana for the fix tools.
- **Forge harness:** filter-land playability, rewind zone order, Treasure ranked last in auto-pay, a stack-target
  check that no longer crashes on Spider-Sense, and undoing a mana tap also undoing what that tap triggered.
- **Forge card scripts:** 29 scripts that remembered cards and never cleared them, so a second use acted on old cards
  (`docs/reviews/forge-remembered-audit.md`).
- **Forge rules code:** `TriggerHandler.removeWaitingTapsForMana`, used by that undo.
