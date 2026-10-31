# Third-party notices

| Component | Used how | Licence | Notes |
|---|---|---|---|
| [Manabrew](https://github.com/witchesofthehill/manabrew) relay, web client and self-hosted node | Our modified builds of the relay and node (`mtg-relay:exile`, `mtg-forge-node:exile`) plus the stock web image `ghcr.io/witchesofthehill/manabrew-web`, run as separate processes | AGPL-3.0-or-later / GPL-3.0-or-later (see its LICENSE.md) | Pinned by digest in `stack/compose.yml` |
| Manabrew protocol specification ([docs.manabrew.app/protocol](https://docs.manabrew.app/protocol/)) | The bridge implements the relay protocol; `bridge/state-delta.js` was written from its "State patches" section (2026-10-20; it replaced an earlier port of Manabrew's AGPL `stateDelta.ts`, so no AGPL code remains) | CC-BY-4.0, © the Manabrew authors | Attribution: this line and the file header |
| [Forge](https://github.com/Card-Forge/forge) | The rules engine inside the Manabrew node image | GPL-3.0 | `bridge/forge-cards.json` is a list of card names built from it (`tools/build-forge-card-index.js`) |
| "MTG 4 player table - scripted" ([Workshop 2296042369](https://steamcommunity.com/sharedfiles/filedetails/?id=2296042369)) | `tools/make-engine-copy.js` patches the user's own downloaded copy; short lines of its scripts appear as find/replace patterns | Its author's | The table's scripts are not in this repo. The docs describe its functions (docs/table-functions-*.md, table-review/) |
| Scryfall | Card images and token lookups at run time | [Scryfall API guidelines](https://scryfall.com/docs/api) | Images are not stored in the repo |
| Magic: The Gathering | Card names, rules text and images shown at run time | © Wizards of the Coast | Unofficial Fan Content under the Fan Content Policy |
| [fengari](https://github.com/fengari-lua/fengari), [luaparse](https://github.com/fstirlitz/luaparse) | Test-only (headless Lua) in `tests/lua` (`npm install`) | MIT | Not shipped |
| [PresentMon](https://github.com/GameTechDev/PresentMon) | Test-only frame timing (`tools/presentmon/`, not in the repo) | MIT | Download separately |
