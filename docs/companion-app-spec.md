# Companion app spec: one-click host and server setup

Status: spec, 2026-10-20. Replaces the idea in SPEC.md §10b. Builds on docs/server-setup-spec.md (A–Z steps) and
`reports/Cloud hosting setup step by step.md`.

## 1. Goal

Whoever hosts game night runs one Windows app instead of a terminal and a 16-step guide. The app has two jobs:

1. **Host setup (once):** check and install what the host's PC needs, install the engine-mode table, and optionally
   build the cloud Forge server.
2. **Game night (every time):**
   - **Start:** server up, bridge up, TTS open.
   - **Watch:** status lights, lag and upload readouts.
   - **End:** everything down, the cloud server deleted, a cost summary.

Friends who join need nothing but TTS and a Steam invite. The app is only for the host.

## 2. Modes

| Mode | Forge + relay run on | Needs | Cost |
|---|---|---|---|
| **Home** (default) | the host's PC, in Docker Desktop | Docker Desktop (WSL2) | free |
| **Cloud Forge** | a DigitalOcean droplet created from a snapshot each night and deleted after; linked by Tailscale | DigitalOcean API token, Tailscale account | ~$2.50/month |
| **Own server** | any server the user already runs | relay address + key | — |

The bridge always runs on the host's PC, because TTS only talks to localhost (SPEC §2). A cloud Windows host
(server-setup shape A) runs this same app on the VM.

## 3. Screens

1. **First-run wizard**
   - **Checks:**
     - Steam and TTS installed (registry / `steamapps`);
     - the table save present (copies "MTG 4 player table - ENGINE MODE.json" into `Documents/My Games/Tabletop Simulator/Saves`);
     - port 39998/39999 free (warns if the VSCode TTS plugin holds 39998);
     - Docker Desktop running (Home mode).
   - **Choose a mode.** Cloud Forge asks for the DigitalOcean token and a Tailscale auth key, then builds the server (§4).
   - **Generates** a long random relay key.
2. **Dashboard**
   - Status lights: TTS connected · Bridge · Relay · Forge room · Cloud server (with its running cost tonight).
   - Engine round trip (the bridge's own timing), host upload meter (the `tools/net-upload-meter.ps1` logic), TTS
     frame-time warning (from the bridge's `/stats`).
   - Buttons: **Start game night**, **End game night**, **Restart Forge room** (= `mtg reset`), **Open TTS**
     (`steam://rungameid/286160`), **Open logs**, **Save a bug report** (zips bridge log, console log, last game stream).
3. **Settings:** mode, region, droplet size, auto-shutdown time, AI decks, update channel.

## 4. Cloud Forge, automated (server-setup steps B–H without a terminal)

- **Build (once):**
  - Create a droplet through the DigitalOcean API with **cloud-init** user data that:
    - installs Docker Engine + compose from Docker's repo;
    - installs Tailscale and joins with the auth key (tagged `tag:forge`, key expiry off);
    - writes our compose file (relay bound to the Tailscale IP, images pinned by digest, key from `.env`);
    - runs `docker compose up -d`.
  - The app waits for the relay's health check over Tailscale, plays a 2-turn headless smoke game (the
    `rules-check` harness), snapshots the droplet as **golden**, then deletes the droplet.
- **Each night:**
  - Create the droplet from the newest golden snapshot.
  - Wait for Tailscale and the health check, then start the bridge with `MTG_RELAY=ws://<droplet>:9443`.
  - **End:** stop the bridge, delete the droplet.
  - The DigitalOcean firewall allows SSH from the host's IP only; nothing else is public.
- **Safety nets:**
  - A droplet left running past the auto-shutdown time (default 03:00) or idle for 45 min (no game, no seated
    players) is deleted, with a Windows notification first.
  - On app start, any `mtg-forge-*` droplet still running from a crash is listed with a "Delete now" button.
- **Updates:** a new engine image means rebuilding the golden snapshot. The app offers it when a new pinned digest
  ships with an app update.

## 5. Bridge changes the app needs

1. ~~Heartbeat + automatic reconnect to the relay.~~ Done 2026-10-20 (bridge `Seat.connect` / `heartbeat` / `onClosed`).
2. A small **local control API** on the debug port (already `127.0.0.1` only, Origin-checked): `/stats` exists; add
   `/health` (relay connected, room status, game running) and `POST /shutdown`.
3. Config by environment variables (already: `MTG_RELAY`, `MTG_KEY`, ports).

## 6. How it's built

- **Shell: Tauri v2** (Rust + a web UI): a ~10 MB installer. Manabrew already uses Tauri (`manabrew/src-tauri`), so
  its build setup can be copied. Electron would work but is ~10× bigger.
- **Bridge as a sidecar:** `bridge.js` packed into one exe with Node's single-executable applications (Node SEA).
  Tauri starts, watches and stops it (`tauri-plugin-shell` sidecar).
- **Secrets:** Windows Credential Manager (Tauri `keyring` plugin): the DigitalOcean token, the Tailscale key and the
  relay key. Never in plain files or logs.
- **Cloud API:** DigitalOcean REST from Rust (`reqwest`); no `doctl` needed. Tailscale: the user installs the
  Tailscale app once (the wizard links it); the droplet joins with an auth key.
- **Docker (Home mode):** `docker compose` CLI calls, as the bridge's "mtg reset" already does.
- **Updates:** Tauri updater against GitHub Releases (signed).
- **Licence:** the app is our code (same licence as the repo). It talks to Manabrew over its published protocol and
  starts its Docker images unmodified (SPEC §9).

## 7. Phases

| Phase | Delivers | Size |
|---|---|---|
| 0 | Bridge heartbeat + reconnect; `/health` | small |
| 1 | Tauri shell + bridge sidecar + dashboard (Home mode only) | medium |
| 2 | First-run wizard: checks, save install, key generation | small |
| 3 | Cloud Forge: build golden, nightly create/delete, safety nets, cost readout | medium |
| 4 | Bug-report zip, upload meter, updater, installer signing | small |

## 8. Tests

- Bridge reconnect: kill and restart the relay container mid-game in a headless run; the game must continue.
- Cloud Forge lifecycle against the real DigitalOcean API with a $0.02 test droplet. Checks:
  - the build creates a snapshot;
  - the night run creates and deletes the droplet;
  - a "crashed" droplet is found on the next start.
- The wizard on a clean Windows VM (no Docker, no TTS) shows each missing piece with a working link.

## 9. Open questions

- Code signing certificate for the installer (unsigned Tauri apps trigger SmartScreen warnings).
- Whether the app should also manage a shape A Windows GPU host (AWS start/stop), or leave that to the docs. Proposal:
  later, as a "Cloud host" mode, if anyone actually needs it.
