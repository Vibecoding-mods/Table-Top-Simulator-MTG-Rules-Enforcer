# MTG Commander in Tabletop Simulator, with the rules enforced

Play Magic: The Gathering **Commander** on a Tabletop Simulator (TTS) table the way you always have (drag cards,
click your library, use the table's buttons), while the **Forge** rules engine runs the game underneath:
- it checks every move;
- it handles triggers, the stack, priority and combat;
- it answers for the AI players.

Think MTG Arena's rules on a free-form tabletop.

> Status (October 2026): playable. 1v1 played over TTS multiplayer; 4-player games against Forge AI played to the end.
> Rules checks pass for commander tax, 21 commander damage, the command-zone choice, 4-player priority and turn order.
> 27 hand-test decks were played through the table, then every keyword they missed. See [PLAN.md](PLAN.md) for what's
> done and what's next, and [docs/](docs/) for each deck's findings (HAND-TEST-HPnn.md).

## How it works

```
TTS table (Lua, "ENGINE MODE")  ⇄  bridge (Node.js)  ⇄  Manabrew relay  ⇄  Manabrew node  ⇄  Forge (Java)
     on the host's PC              on the host's PC        Docker               Docker
```

- **The table** is a modified copy of the group's scripted 4-player table
  ([Workshop 2296042369](https://steamcommunity.com/sharedfiles/filedetails/?id=2296042369)). Our script draws the
  engine's board as real cards, shows its questions Arena-style (glowing playable cards, a card row, corner buttons)
  and turns your drags and clicks into answers.
- **The bridge** (`bridge/bridge.js`) talks to TTS through its External Editor API (localhost only) and to the engine
  through Manabrew's relay, one engine seat per TTS player.
- **The relay** routes messages between the bridge and the engine, and the **node** hosts one Forge game. Both come from
  [Manabrew](https://github.com/witchesofthehill/manabrew), in **our own modified builds** (`mtg-relay:exile` and
  `mtg-forge-node:exile`): the stock images don't carry what the table needs (exile links, manual fixes, cost Cancel,
  seat order, and more). See "Building the engine" below.
- **Forge** is the Java rules engine inside the node. It decides everything: legal plays, the stack, triggers, combat, AI.
  The bridge and the table never rule on anything; they show what Forge says and send back what the player chose.

A move, end to end: you drag a card, the table's Lua asks the bridge to play it, the bridge sends that to the relay,
Forge checks it and updates the game, and the new board comes back the same way and is redrawn as real TTS cards.

### What it uses

| Part | Technology | Runs where |
|---|---|---|
| Table script | Lua inside TTS (`tools/engine-renderer.lua`, appended to the table's Global) | Host's TTS; other players' TTS show it |
| Bridge | Node.js 22+, no npm dependencies (`bridge/bridge.js`) | Host's PC |
| Relay | Rust (Manabrew `manabrew-server`), our build, in Docker | Host's PC, or a server |
| Rules engine | Forge (Java, compiled with GraalVM) in Manabrew's self-hosted node (Rust), our build, in Docker | Host's PC, or a server |
| Card images | Fetched at run time through Scryfall data; none stored in this repo | Internet |

Ports, all on localhost: 39998 and 39999 (TTS External Editor API), 9443 (relay), 8080 (Manabrew's web client, optional),
48787 (the bridge's debug endpoint).

More: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [SPEC.md](SPEC.md).

## What you need (host only)

- Windows with Tabletop Simulator (Steam) and the Workshop table above.
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (WSL2), limited to **2 CPU cores** and 8 GB RAM for
  Forge, so the engine can't take CPU from TTS. On a 6-core PC, TTS crashed with the engine on 3 cores and stayed stable
  through a 28-deck test run on 2 (2026-11-05). Put this in `%USERPROFILE%\.wslconfig`, then run `wsl --shutdown` and
  restart Docker Desktop:

  ```ini
  [wsl2]
  processors=2
  memory=8GB
  ```

  After `wsl --shutdown`, restart the relay container too (`docker restart stack-relay-1`), or games fail at setup.
  Capping TTS's frame rate (Options → Graphics) also helps.
- [Node.js](https://nodejs.org/) 22 or newer.
- The engine images, built once (see "Building the engine"): about 20 minutes and several GB of disk.

Players who join only need TTS and a Steam invite.

## Building the engine

`stack/compose.yml` runs two images built from upstream Manabrew and Forge plus our patches. Build them once, about 20
minutes, in Git Bash on Windows or any shell on Linux:

```bash
bash engine/build-images.sh
```

Never swap images in the middle of a game. [engine/README.md](engine/README.md) has what the patches do and why they're
published: Forge and Manabrew are copyleft, so our changes to them stay open under their licences.

## Quick start

```bash
docker compose -f stack/compose.yml up -d
```

```bash
node tools/make-engine-copy.js
```

```bash
node bridge/bridge.js
```

1. `docker compose ... up -d` starts the relay and the Forge room.
2. `make-engine-copy.js` builds the save "MTG 4 player table - ENGINE MODE" from your Workshop copy.
3. `bridge.js` starts the bridge, or use `tools/start-bridge.ps1` to run it hidden and restarting.
4. In TTS, load **Games → Saves → "MTG 4 player table - ENGINE MODE"**.
5. Import decks with the table's Card Importer as usual and put each commander on the command zone. Then press
   **READY?** on your playmat (it turns green once your deck checks out) and, when everyone is green, **START GAME**
   between the life counters. The same in chat:

| Command | What it does |
|---|---|
| `mtg engine on` | rules engine on (host) |
| `mtg ready` / `mtg ready all` | check your deck (or everyone's) against the engine's card list |
| `mtg friendly 0\|1\|2` | vote for free mulligans (also the Friendly button under READY) |
| `mtg start` / `mtg start ai 2` | start the game, optionally with Forge AI players (host) |
| `mtg undo` / `mtg undo N` | rewind to an earlier point; the other players vote |
| `mtg vote yes` / `mtg vote no` | answer a rewind vote |
| `mtg skip <phase>` / `mtg skip off` | pass priority until that phase: upkeep, draw, main, combat, blockers, damage, main2, end, mine (also the **Auto-resolve** list) |
| `mtg hold` / `mtg hold off` | keep priority once this turn after something goes on the stack, to respond to your own spell (also the **Hold** button) |
| `mtg timer [seconds]` / `mtg timer off` | turn timers for everyone (host); default 60 seconds a decision plus a time bank |
| `mtg concede` | leave the game (asks once more) |
| `mtg winner <colour>` | declare the winner, e.g. for Treachery (host) |
| `mtg glow` | playable-card glow on/off |
| `mtg reset` | end the game and put the imported decks back (host) |

Playing online: the host's upload carries every player, so host from a wired connection with good upload.

## Running the engine on a server

TTS and the bridge stay on the host's PC; the relay and Forge can run on a small Linux server. On an Ubuntu or Debian
server, join it to the same [Tailscale](https://tailscale.com/) network as the host's PC, copy this repository there, and run:

```bash
sudo bash tools/setup-server.sh
```

It installs Docker if needed, creates a secret key in `stack/.env`, builds the engine, starts it, and prints the exact
bridge command for the host. The relay binds to the Tailscale address, or to 127.0.0.1 if there is none, so it's never
open to the internet unless you pass `--public`. See `--help` for the options, and
[docs/server-setup-spec.md](docs/server-setup-spec.md) for choosing a server.

## Tests

All run headless; no TTS needed:

```bash
node tests/test_bridge_golden.js
```

```bash
node tests/test_table_golden.js
```

The table test needs the Workshop table on your PC: subscribe to it, or set `MTG_TABLE_JSON` to your copy of its JSON.

```bash
bash tools/rules-check.sh tax
```

- **`test_bridge_golden.js`:** 849 bridge scenarios against recorded outputs.
- **`test_table_golden.js`:** the table's Lua replayed on a fake TTS (needs `npm install` in `tests/lua`).
- **`rules-check.sh`:** Commander rules against the real engine. Other modes: `cmddmg`, `exile`, `library`,
  `keywords`, `rewind`, `concede`.

How each test works and what it can't see: [TESTING.md](TESTING.md).

## Repository map

| Path | What |
|---|---|
| `bridge/` | the bridge, the deck presets loader, engine test drivers (`rules-check.js`, `priority-check.js`) |
| `tools/engine-renderer.lua` | the table's engine code (appended to the table's Global script) |
| `tools/make-engine-copy.js` | builds the ENGINE MODE save from the Workshop table (security fixes, engine-mode gates) |
| `decks/` | our AI, test and rules-check decks |
| `stack/` | Docker Compose for the engine |
| `engine/` | our patches to Manabrew and Forge, the script that builds the images, and why they're published |
| `tests/` | golden masters, claims tests, the fake TTS (`tests/lua/`) |
| `docs/` | architecture, references, specs (M7 manual fix, companion app, server setup) |
| `reports/` | research reports (stutter, hosting, effects) |

## Credits and legal

- Rules engine: [Forge](https://github.com/Card-Forge/forge) (GPL-3.0) through
  [Manabrew](https://github.com/witchesofthehill/manabrew) (AGPL-3.0), run as separate programs, with our changes to
  both. Those changes stay under their licences and their source must be published with any build we share.
- The table: "MTG 4 player table - scripted" by its Workshop author; this repo only contains the script that adapts
  your own copy.
- Card images come from [Scryfall](https://scryfall.com/docs/api) under its guidelines.
- Magic: The Gathering is © Wizards of the Coast. This is unofficial Fan Content permitted under the
  [Fan Content Policy](https://company.wizards.com/en/legal/fancontentpolicy). Not approved/endorsed by Wizards.
  Portions of the materials used are property of Wizards of the Coast. © Wizards of the Coast LLC.

See [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

**Licence: public domain** ([The Unlicense](LICENSE)). Do whatever you like with this project's code. That covers our
code only, not Manabrew, Forge (or our changes to them), the Workshop table or Magic's cards (see the notices).
