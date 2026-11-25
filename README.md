# MTG Commander in Tabletop Simulator, with the rules enforced

Play Magic: The Gathering **Commander** on a Tabletop Simulator (TTS) table the way you always have (drag cards,
click your library, use the table's buttons), while the **Forge** rules engine runs the game underneath:
- it checks every move;
- it handles triggers, the stack, priority and combat;
- it answers for the AI players.

Think MTG Arena's rules on a free-form tabletop.

> **To play: download the `MTG-Table-<date>-<hash>.zip` from the [Releases page](https://github.com/Vibecoding-mods/Table-Top-Simulator-MTG-Rules-Enforcer/releases/latest)**,
> not the green **Code → Download ZIP** button (that is the source code, without the engine). Steps: [The easy way](#the-easy-way-the-one-click-package).

Made with [Claude Code](https://claude.com/claude-code): the code, tests and docs in this repository were written with
Anthropic's AI coding assistant, directed and play-tested by the project's owner.

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

### Forge and Manabrew: who does what

The two names often get used as one ("the engine"), because they ship together in one Docker image. They are two
layers:

- **[Forge](https://github.com/Card-Forge/forge) is the brain.** An open-source Magic program (Java, GPL-3.0), around
  since about 2007. It knows the rules: the stack, priority, triggers, combat, layers and state-based actions. It has
  scripts for nearly every card ever printed, and it plays the AI opponents. On its own it is a desktop app for one person
  against the computer, with no network play another program could plug into.
- **[Manabrew](https://github.com/witchesofthehill/manabrew) is the server around it** (AGPL-3.0). It runs Forge
  without its screens and puts it on the network:
  - the **node** hosts a Forge game, and its harness turns each of Forge's questions ("choose targets", "declare
    blockers") into a message and each answer back into Forge's choice;
  - the **relay** is the meeting point, where the players' clients and the node connect, games are set up and messages
    are routed;
  - the **protocol** is the published message format: the board as small change patches, questions out, answers back.

  Manabrew also has its own web client, which this project doesn't use: TTS is the client.
- **Our bridge** translates between Manabrew's messages and TTS (a question becomes glowing cards and buttons; your
  drag or click becomes the answer), and **our table script** draws it all.

Our changes to each live in [engine/](engine/README.md): `forge.patch` holds rules-level fixes inside Forge, and
`manabrew.patch` holds harness changes (what is asked and how, and the extra board details the table needs, such as
debug mode, the manual fix and rewind). As a rule of thumb, a wrong rules outcome is usually Forge, while a missing or
odd question, or a missing board detail, is usually Manabrew's harness.

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

## The easy way: the one-click package

For playing rather than developing. Nothing to build, and no Node.

### Host requirements

The PC that runs the engine (the host). Friends who only join need just Tabletop Simulator.

- Windows 10 or 11 on an x64 processor (Intel or AMD). Windows on ARM won't run the engine.
- At least 4 CPU cores and 16 GB of RAM recommended. The engine uses 2 cores and about 8 GB inside Docker; TTS and
  Windows need the rest. These are estimates, not measured limits.
- About 2 GB of free disk.
- [Docker Desktop](https://www.docker.com/products/docker-desktop/):
  - In its installer, choose **"All-users installation"**: it turns on Windows' Virtual Machine Platform, which
    Docker needs. Or run `wsl --install` in an administrator PowerShell and restart the PC.
  - Then start Docker once, and sign out of Windows and back in (the install adds you to the `docker-users` group).
  - If Docker says virtualization is off, enable SVM (AMD) or Intel VT-x (Intel) in the BIOS/UEFI. Hold Shift
    while clicking Restart, then Troubleshoot → Advanced options → UEFI Firmware Settings. It's usually under
    Advanced, CPU Configuration or Overclocking. Save with F10.
  - Step-by-step help for Docker that won't start (the BIOS, the administrator terminal, WSL, the docker-users
    group), with the Mac and Linux equivalents: [docs/docker-setup.md](docs/docker-setup.md).
- Tabletop Simulator (Steam).
- The tables, subscribed on the Steam Workshop:
  [4 player](https://steamcommunity.com/sharedfiles/filedetails/?id=2296042369) and
  [6 player](https://steamcommunity.com/sharedfiles/filedetails/?id=2293586471). Start TTS once afterwards so Steam
  downloads them. The package doesn't include the tables: the companion makes the rules-engine table from your own
  copy (Steam's Subscriber Agreement lets subscribers use Workshop items, not hand out copies).

### Steps

1. Install Docker Desktop as above, start it once, and accept its terms. Let it update WSL if it asks.
2. Subscribe to the table on the Workshop and start TTS once.
3. Download the latest `MTG-Table-<date>-<hash>.zip` from this repository's **Releases** page (under Assets; not
   "Source code" and not the green Code button, which have no engine).
4. Unzip it anywhere and double-click **MTG Companion.exe**, then press **Start engine**.
   - Windows may warn that the app is unsigned: choose **More info → Run anyway**.
   - The first start loads the engine into Docker and takes a few minutes. It makes the table from your Workshop copy
     and installs it as a TTS save. The lights turn green when it's ready.
5. In Tabletop Simulator, load **MTG Table (rules engine)** from your saves.

`README-FRIEND.txt` in the zip has the details. A light stays red, or something else is wrong? See
**[Troubleshooting and FAQ](docs/TROUBLESHOOTING.md)** (the companion has a short version under **Help**). The rest of this page is for hosts
who build and run everything themselves.

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
| `mtg engine on` | rules engine on (anyone; also the button in the middle of the table) |
| `mtg ready` / `mtg ready all` | check your deck (or everyone's) against the engine's card list |
| `mtg friendly 0\|1\|2` | free mulligans each, for everyone (also the **Free mulligans** button on the left rim, where the cannon sits outside engine mode) |
| `mtg start` / `mtg start ai 2` | start the game, optionally with Forge AI players (anyone) |
| `mtg undo` / `mtg undo N` | rewind to an earlier point; the other players vote |
| `mtg vote yes` / `mtg vote no` | answer a rewind vote |
| `mtg skip <phase>` / `mtg skip off` | pass priority until that phase: upkeep, draw, main, combat, blockers, damage, main2, end, mine (also the **Auto-resolve** list) |
| `mtg hold` / `mtg hold off` | keep priority once this turn after something goes on the stack, to respond to your own spell (also the **Hold** button) |
| `mtg timer [seconds]` / `mtg timer off` | turn timers for everyone (host); default 60 seconds a decision plus a time bank |
| `mtg concede` | leave the game (asks once more) |
| `mtg winner <colour>` | declare the winner, e.g. for Treachery (host) |
| `mtg glow` | playable-card glow on/off |
| `mtg reset` | end the game and put the imported decks back (anyone once it's over; host mid-game) |

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

- Made with [Claude Code](https://claude.com/claude-code) (Anthropic's AI coding assistant): it wrote this
  repository's code, tests and docs, including our changes to Manabrew and Forge.
- Rules engine: [Forge](https://github.com/Card-Forge/forge) (GPL-3.0) through
  [Manabrew](https://github.com/witchesofthehill/manabrew) (AGPL-3.0), run as separate programs, with our changes to
  both. Those changes stay under their licences and their source must be published with any build we share.
- The tables: "MTG 4 player table - scripted"
  ([Workshop 2296042369](https://steamcommunity.com/sharedfiles/filedetails/?id=2296042369)) and "MTG 6 player table -
  scripted" ([Workshop 2293586471](https://steamcommunity.com/sharedfiles/filedetails/?id=2293586471)), both by the
  same Workshop author; this repo only contains the script that adapts your own copy.
- Card images come from [Scryfall](https://scryfall.com/docs/api) under its guidelines.
- DeckCheck deck links (bracket and threat level): [DeckCheck](https://deckcheck.co) through its public API
  ([deckcheck.co/docs/api](https://deckcheck.co/docs/api)), read-only, one request per import, nothing stored.
  Not affiliated with DeckCheck.
- Sound effects (played from Steam Cloud links; no audio files are in this repo):
  - Wipe, instant and exile: "Spell Sounds Starter Pack" by p0ss
    ([OpenGameArt](https://opengameart.org/content/spell-sounds-starter-pack)),
    [CC-BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/). We trimmed, levelled, padded, stacked and
    amplified them; our edited clips are CC-BY-SA 3.0 too.
  - Sorcery: "PowerDrain" by Iwan 'qubodup' Gabovitch ([qubodup.net](http://qubodup.net)),
    [CC-BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/). We reversed it, changed its speed, levelled it
    and added our own sounds; our edited clip is CC-BY-SA 3.0 too.
  - Damage: "37 hits/punches" by Independent.nu ([OpenGameArt](https://opengameart.org/content/37-hitspunches)), CC0.
  - Treasure: "Sack of Gold" by Amarikah ([OpenGameArt](https://opengameart.org/content/sack-of-gold)), CC0.
  - Knockout: ours (public domain, like the code).
  - The sources of the death, lifegain, countered, counter, player-hit and big-hit sounds are not yet identified;
    they are to be credited or replaced. Full list: [docs/sound-credits.md](docs/sound-credits.md).
- Magic: The Gathering is © Wizards of the Coast. This is unofficial Fan Content permitted under the
  [Fan Content Policy](https://company.wizards.com/en/legal/fancontentpolicy). Not approved/endorsed by Wizards.
  Portions of the materials used are property of Wizards of the Coast. © Wizards of the Coast LLC.

See [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

**Licence: public domain** ([The Unlicense](LICENSE)). Do whatever you like with this project's code. That covers our
code only, not Manabrew, Forge (or our changes to them), the Workshop table, the table's sound effects (above) or
Magic's cards (see the notices).
