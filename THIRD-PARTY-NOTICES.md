# Third-party notices

This project was made with [Claude Code](https://claude.com/claude-code), Anthropic's AI coding assistant: it wrote our
code, tests and docs, and our patches to Manabrew and Forge. It is a tool, not a component: nothing of it ships.

| Component | Used how | Licence | Notes |
|---|---|---|---|
| [Manabrew](https://github.com/witchesofthehill/manabrew) relay, web client and self-hosted node | Our modified builds of the relay and node (`mtg-relay:exile`, `mtg-forge-node:exile`) plus the stock web image `ghcr.io/witchesofthehill/manabrew-web`, run as separate processes | AGPL-3.0-or-later / GPL-3.0-or-later (see its LICENSE.md) | Pinned by digest in `stack/compose.yml` |
| Manabrew protocol specification ([docs.manabrew.app/protocol](https://docs.manabrew.app/protocol/)) | The bridge implements the relay protocol; `bridge/state-delta.js` was written from its "State patches" section (2026-10-20; it replaced an earlier port of Manabrew's AGPL `stateDelta.ts`, so no AGPL code remains) | CC-BY-4.0, © the Manabrew authors | Attribution: this line and the file header |
| [Forge](https://github.com/Card-Forge/forge) | The rules engine inside the Manabrew node image | GPL-3.0 | `bridge/forge-cards.json` is a list of card names built from it (`tools/build-forge-card-index.js`) |
| "MTG 4 player table - scripted" ([Workshop 2296042369](https://steamcommunity.com/sharedfiles/filedetails/?id=2296042369)) | `tools/make-engine-copy.js` patches the user's own downloaded copy; short lines of its scripts appear as find/replace patterns | Its author's | The table's scripts are not in this repo. The docs describe its functions (docs/table-functions-*.md, table-review/) |
| Scryfall | Card images and token lookups at run time | [Scryfall API guidelines](https://scryfall.com/docs/api) | Images are not stored in the repo |
| "Spell Sounds Starter Pack" by p0ss ([OpenGameArt](https://opengameart.org/content/spell-sounds-starter-pack)) | The table's wipe, instant and exile sounds and their bursts (probable source, to be confirmed by the user), trimmed, levelled, padded and stacked; played from the host's Steam Cloud links, the files are not in the repo | [CC-BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) (also offered under GPL 2.0/3.0) | Our edited clips are CC-BY-SA 3.0 too, not public domain. Attribution text: docs/sounds.md "Licences and sources" |
| "37 hits/punches" by Independent.nu ([OpenGameArt](https://opengameart.org/content/37-hitspunches)) | The table's damage sound and its bursts (likely source), edited as above | CC0 | No attribution required |
| The table's death and lifegain sounds | Played from the host's Steam Cloud links | **Unknown** | Source not identified (docs/sounds.md): not cleared for a public release until it is, or until they are replaced |
| "PowerDrain" by Iwan 'qubodup' Gabovitch (http://qubodup.net, 2012) | The table's sorcery sound (2026-11-12): reversed, 3x faster, trimmed, levelled, padded; to be played from the host's Steam Cloud link, the file is not in the repo | [CC-BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | Our edited clip is CC-BY-SA 3.0 too. Attribution text: docs/sounds.md "Licences and sources" |
| The table's countered, counter, playerhit and bighit sounds (2026-11-12) | To be played from the host's Steam Cloud links | **Unknown** | The user's files, source not identified (docs/sounds.md): not cleared for a public release until it is, or until they are replaced |
| Magic: The Gathering | Card names, rules text and images shown at run time | © Wizards of the Coast | Unofficial Fan Content under the Fan Content Policy |
| [fengari](https://github.com/fengari-lua/fengari), [luaparse](https://github.com/fstirlitz/luaparse) | Test-only (headless Lua) in `tests/lua` (`npm install`) | MIT | Not shipped |
| [PresentMon](https://github.com/GameTechDev/PresentMon) | Test-only frame timing (`tools/presentmon/`, not in the repo) | MIT | Download separately |
