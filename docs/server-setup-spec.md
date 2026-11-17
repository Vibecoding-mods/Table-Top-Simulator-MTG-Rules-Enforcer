# Server setup spec: hosting our MTG Commander table online

Status: v2, 2026-10-20 (v1 proposal 2026-10-19). Full hosting paused by the user on 2026-11-02; the latest state is
"Full hosting status, 2026-11-02" at the end. Prices are October 2026, USD, US regions. Full A–Z steps with commands and sources: `reports/Cloud hosting setup step by step.md`; the first comparison: `reports/Cloud hosting for online TTS games.md`.

## 0. Decision and A–Z overview (2026-10-20)

**Recommended: shape B, "Forge in the cloud, TTS at home".**
- Who runs what:
  - a player hosts TTS and the bridge at home;
  - Forge and the relay run on a **DigitalOcean CPU-Optimized droplet (4 dedicated vCPU / 8 GB, $0.125/h)**.
- The droplet is **created from a snapshot each game night and deleted afterwards**: about **$2.50/month** at 15 h.
- **Tailscale** joins the bridge PC and the droplet, so no public port is opened, and there is no domain or TLS to manage.

**Upgrade if the host's home upload is the problem: shape A**
- An **AWS g4dn.xlarge** (Windows Server 2022, NVIDIA gaming driver, Amazon DCV for remote access) runs TTS and the
  bridge, plus the same Forge droplet: about **$21–23/month** at 15 h, because the Windows disk bills all month.
- **Docker can't run on any GPU VM** (no nested virtualisation on AWS g4dn/g5 or Azure NVadsA10 v5), so Forge always
  lives on the Linux droplet.

**Changed since v1:**
- **Hetzner US is out:** 4 vCPU / 8 GB went from $24.99 to $73.49/month (June 2026).
- **Oracle's free ARM tier is out:** it shrank to 2 cores / 12 GB, and the image is x86-only.
- **Shut down by deleting:** a powered-off droplet or Hetzner server still bills, so "off" must mean snapshot + delete.

**A–Z (each step is spelled out with commands in the report):**

| # | Step | Time | Shape |
|---|---|---|---|
| A | Accounts: DigitalOcean (API token), Tailscale; on the host PC install `doctl`, Tailscale, an SSH key | 20 min | both |
| B | Create the droplet (Ubuntu 24.04, CPU-Optimized 4/8, region nearest the host) + a cloud firewall that allows only SSH from your IP | 10 min | both |
| C | First login: updates, a non-root user, SSH keys only, unattended security updates (already on by default) | 15 min | both |
| D | Docker Engine from Docker's own repo + the compose plugin | 10 min | both |
| E | Tailscale on the droplet; turn key expiry off; ACL: only the host PC may reach port 9443 | 5 min | both |
| F | Deploy the stack: our `stack/compose.yml` (relay bound to the Tailscale IP, **never** `manabrew/compose.selfhost.yml`, which publishes 9443 to the internet), our own images built from `engine/`, a long random `MANABREW_SERVER_KEY`. `tools/setup-server.sh` does all of this | 20 min | both |
| G | Point the bridge at it: `MTG_RELAY=ws://<droplet tailscale name>:9443 MTG_KEY=<key> node bridge.js`; play a test game vs AI | 10 min | both |
| H | Snapshot the droplet ("golden"), delete it; from now on `vps-up.ps1` / `vps-down.ps1` create and delete it each night | 10 min | both |
| I | AWS account + **GPU quota request** ("Running On-Demand G and VT instances" ≥ 4), 2 days ahead | — | A |
| J | Launch g4dn.xlarge, Windows Server 2022, 100 GB gp3, IAM role with S3 read (driver + DCV licence) | 15 min | A |
| K | NVIDIA **gaming** driver from AWS's bucket + its registry key and certificate (the public Tesla driver has no graphics) | 45 min | A |
| L | Amazon DCV (free on EC2) for remote access; auto-logon; never lock the desktop (TTS needs a live GPU session) | 45 min | A |
| M | A dedicated Steam account that owns TTS (one account can't play in two places); Steam Guard via the mobile app | 30 min | A |
| N | TTS + the table, Node + the bridge (Task Scheduler at logon), Tailscale | 45 min | A |
| O | Three shutdown nets: the bridge's idle check, a nightly 03:00 stop, a CloudWatch alarm | 30 min | A |
| P | Game night: `night-up.ps1` → load the table → friends join by Steam invite → `night-down.ps1` | — | both |

**Code changes this needs (ours):**
1. ~~Bridge: ping/pong heartbeat and automatic reconnect to the relay.~~ **Done 2026-10-20**: a dropped or silent link is
   reconnected within the relay's 60 s window and the game resyncs (tested live by restarting the relay mid-game).
2. `vps-up.ps1` / `vps-down.ps1` (+ `night-up/down.ps1` for shape A) in `tools/`. **Written 2026-11-02**, syntax-checked
   only, never run against real accounts.
3. ~~A compose file for the droplet.~~ **Done 2026-10-30** by `tools/setup-server.sh` on `stack/compose.yml`: relay bound to
   the Tailscale IP (`RELAY_BIND`), our images built from `engine/`, key in `stack/.env`, which isn't committed.
4. The companion app (docs/companion-app-spec.md) wraps steps G, H and P into buttons. Since its 2026-11-05 rewrite
   that is a later phase, after Home mode.
   **Step G is built (2026-11-17):** the companion's own-server mode (docs/companion-app-spec.md §5.8) points a
   friend's companion and bridge at a host's engine: `server.json` (address and key; no status-page box, the owner's
   decision of 2026-11-17), a "Your server" light that says whether the server answers and warns when its engine build
   isn't the table's, and no Docker on the friend's PC. The relay must be reachable from the friend's PC: **Tailscale
   only** (the owner's decision): `tools/setup-server.sh` binds the relay to the Tailscale address (`RELAY_BIND`), and
   no TLS setup is offered or recommended.

**Step zero (free, before paying for anything):**
- Play one online game on the current home setup, now that the 2026-10-19 snapshot fix is in.
- Throttle Forge locally to see whether its CPU matters at all. Done in effect: the engine runs on 2 WSL cores since
  2026-11-05, after TTS crashed with it on 3 (README).

The chop may already be gone.

---

## Original proposal (v1, 2026-10-19)

## 1. What runs where today

| Piece | What it does | Runs on |
|---|---|---|
| **TTS host** | The table itself. The host's PC simulates every object and sends each change to the other players over Steam's relays. | One player's PC |
| **Bridge** (`bridge/bridge.js`) | Translates between the table and the rules engine: board updates, questions, clicks. | Same PC (it talks to TTS on localhost) |
| **Forge engine + relay** (Docker: `manabrew-node`, relay on 9443) | The rules and the AI players. | Same PC, in Docker (WSL2, capped at 3 cores / 8 GB then; 2 cores since 2026-11-05) |

The **host's upload** carries every player. Forge's AI uses the **host's CPU** when it thinks. Two kinds of server can take over parts of this.

## 2. The two server ideas

### Server A: cloud gaming PC (the TTS host)

**Use:** replace the home PC as the TTS host. It gives everyone a datacenter connection, and the host never stutters because someone on it is gaming, streaming or downloading.

- **What it is:** a rented Windows machine with a graphics card, running the normal TTS game. TTS has no dedicated server, so this is the only way to host it in the cloud.
- **What it fixes:**
  - lag, chops and slow buttons caused by the host's upload or Wi-Fi;
  - the host's PC being busy or freezing.
- **What it doesn't fix:**
  - each player's own PC (first-time card images, its own TTS clean-up pauses);
  - the ~270 ms TTS clean-up pause every ~3 minutes, which happens on any host.
- **Needs:**
  - a **separate Steam account that owns TTS**, because one account can't play in two places;
  - a remote-desktop app (Parsec or Sunshine/Moonlight) to load the table and start games.
- **Candidates (hourly, Windows):**

  | Provider | Price | Notes |
  |---|---|---|
  | airgpu | $0.65/h + $7/month storage | Gaming-PC style, easiest setup |
  | AWS g4dn.xlarge (T4) | ~$0.71/h | Plus disk |
  | Azure NV6ads A10 v5 | $0.73/h | |
  | Shadow PC | $30–60/month flat | 4–8 h session caps and a 30-min idle shutdown; risky for long games |

  Avoid **spot/preemptible** machines: they can be taken away mid-game. Avoid **always-on**: ~$480–535 a month.

### Server B: small Linux server (bridge + Forge)

**Use:** move the rules engine and AI off the host's PC. That frees its CPU and memory, and lets **any friend with good upload host without installing Docker**.

- **What it is:** a cheap Linux VPS running the Forge engine and relay in Docker, plus the bridge.
- **What it fixes:**
  - AI thinking competing with TTS for the host's CPU;
  - the "only the person with Docker can host" limit.
- **What it doesn't fix:** network lag. TTS traffic still goes through whoever hosts TTS.
- **Size:**
  - 2 vCPU / 4 GB is enough for one table; 4 vCPU / 8 GB is comfortable with 3 AI players.
  - Forge idles at about 250 MB of RAM, with an 1100 MB cap.
  - The image is **amd64 only**; ARM (Oracle's free tier) would need a rebuild.
- **Candidates:**

  | Provider | Plan | Price |
  |---|---|---|
  | DigitalOcean or Linode | 2/4 | $0.036/h, ~$2.50 for 70 h of play |
  | DigitalOcean or Linode | 4/8 | $0.071/h, ~$5 for 70 h |
  | OVH VPS-2 | 4/8 | $8.50/month (12-month term) |
  | Contabo Cloud VPS 4 | 4/8 | €5.50/month (24-month term) |
  | Hetzner US CPX31 | 4/8 | $73.49 since June 2026; skip |

  An hourly server still bills while powered off, so destroy it after the game and restore it from a snapshot.
- **Extra cost per action:** about 30–120 ms per engine round trip, small next to the AI's 0.1–0.9 s thinking time.

### Server A + B together

The cloud gaming PC hosts TTS and the VPS runs Forge. Docker may not run on a cloud Windows machine (WSL2 needs nested virtualization), so pairing them is the safe version. If Docker does work there, A alone covers everything.

## 3. Which to pick

| Step | Option | Monthly cost | Pick it when |
|---|---|---|---|
| 0 | **Home host (now)**, wired, upload checked with `tools/net-upload-meter.ps1` | $0 | Default. Today's fixes removed the 10-second chop and click freezes. |
| 1 | **$0 check**: cap Forge to 2 cores at low priority and compare PresentMon frame times (2 cores in use since 2026-11-05) | $0 | Before paying for B. If nothing changes, B buys no smoothness, only flexibility. |
| 2 | **Server B** (hourly VPS) | ~$2–8 | Hosting should rotate between friends, or the host's PC struggles during AI turns. |
| 3 | **Server A** for game nights | ~$11–17 (16 h), ~$50 (70 h) | The upload meter shows the home host is the bottleneck (under ~5 Mbps steady), or friends still see chops. |
| 4 | **A + B** | ~$15–25 for 16 h | Server A can't run Docker. |

**Cost split:** with 4–6 friends, A for four game nights is about $2–4 each a month, and B about $1–2 each.

## 4. Spec: Server B (bridge + Forge on a VPS)

### 4.1 Components

```
 TTS host PC                                   VPS (Linux, Docker)
 ┌───────────────────────────┐   wss://443    ┌────────────────────────────────┐
 │ TTS (table)               │ ─────────────► │ Caddy (TLS, token check)       │
 │  Lua web requests ──────► │   HTTPS POST   │   ├─ bridge (Node)             │
 │                           │                │   ├─ relay :9443 (internal)    │
 │ tts-helper (small Node)   │ ◄───────────── │   └─ manabrew-node (Forge)     │
 │  outbound WebSocket       │  board/prompt  └────────────────────────────────┘
 │  → 127.0.0.1:39999 (TTS)  │
 └───────────────────────────┘
```

- **Table → engine:** the table's Lua already sends web requests, so `engineSend` points at `https://<vps>/msg` instead of `127.0.0.1:48787`.
- **Engine → table:** TTS only takes messages on its own PC (External Editor API, port 39999). A **small helper on the host PC** opens a WebSocket *out* to the VPS and passes each message to `127.0.0.1:39999`. That keeps the path we measured as free, with no open ports on the host.
  - Don't have Lua poll the VPS: every poll would be decoded in Lua, which brings back the stutter we removed.

### 4.2 VPS setup

1. Ubuntu LTS, 2–4 vCPU, 4–8 GB, nearest US region to the group. Keep SSH keys only; firewall allows only 22 and 443.
2. Docker Compose services:
   - `manabrew-node` (amd64 image);
   - `relay`, on the internal network only (no public 9443);
   - `bridge`, with environment `RELAY=ws://relay:9443`, `TTS_MODE=remote`, `BRIDGE_TOKEN=<long random>`;
   - `caddy` for automatic TLS on 443, forwarding `/msg`, `/helper` (WebSocket) and debug routes to the bridge, all requiring the `X-MTG-Token` header.
3. Replace the default relay key `tts-local` with a random one.
4. Snapshot after setup. For hourly billing: restore from the snapshot before game night and destroy it afterwards (a script: `tools/vps-up.sh` / `tools/vps-down.sh`).

### 4.3 Code changes

| Where | Change |
|---|---|
| `bridge/bridge.js` | A "remote" mode: messages for TTS go to connected helpers over WebSocket instead of TCP 39999; token check on `/msg`. |
| `tools/tts-helper.js` (new) | Connects to `wss://<vps>/helper` with the token, forwards each message to 127.0.0.1:39999, reconnects by itself, and shows a tray message if TTS isn't running. |
| Table (`make-engine-copy.js`) | A setting for the bridge address (`mtg server <url>` in chat, saved with the table). The token travels in a header, never in the URL. |
| `tools/start-bridge.ps1` | `-Remote` switch: start only the helper. |

### 4.4 Acceptance tests

- A full 3-player game (host + 2 AI) on the VPS plays to game over with no engine errors and no table mismatches (`tools/run-coverage.sh`).
- Click-to-answer time is at most 150 ms longer than with the local bridge (`tools/tts-latency.lua`).
- PresentMon on the host during AI turns: worst frame no worse than the local setup.
- Pulling the helper's network for 10 s: the game resumes and the table redraws (hello → resync).

## 5. Spec: Server A (cloud gaming PC as TTS host)

### 5.1 Setup

1. **Machine:** airgpu, or AWS g4dn.xlarge / Azure NV6ads A10 v5, in the US region nearest the group. Windows. A 100 GB disk kept between sessions.
2. **Software:**
   - Steam on a dedicated account that owns TTS;
   - TTS with the table (today the "Mock MTGA 4 player" save, `TS_Save_1.json`, kept current by `tools/deploy.js`) and our mods cached;
   - Parsec or Sunshine for remote control;
   - Node, plus Docker if it runs there (otherwise use Server B for Forge).
3. **TTS settings:**
   - Server: Steam (relayed);
   - frame rate capped at 60 (less CPU and GPU use);
   - rewind and autosave as in our table, with the engine's 55 s rewind hold;
   - table loaded, game hosted as Public with a password.
4. **Game-night routine:**
   - start the machine about 15 min early;
   - connect over remote desktop, load the table, host;
   - friends join; disconnect the remote desktop, since a stream left open costs bandwidth;
   - after the game, save the table and **stop the machine**.

### 5.2 Acceptance tests

- `tools/net-upload-meter.ps1` on the cloud host during a 4-player game shows steady upload, with no saturation at the 95th percentile.
- Each player's own PresentMon shows no chop every 10 s and no multi-second stalls when clicking buttons.
- The machine stops automatically after 30 min with nobody connected (scheduled task), so a forgotten machine can't bill all night.

## 6. Open questions

- **Real upload need:** measure with `tools/net-upload-meter.ps1` during the next online game and replace the 5/10 Mbps guideline with real numbers.
- **Docker on cloud Windows:** does it run on airgpu or g4dn? If yes, A alone is enough.
- **Shadow PC:** would its idle detection close an unattended TTS host?
- **Vultr fractional GPU** (~$21.50/month at launch, 2023): the current price, and whether TTS runs on it, could make always-on affordable.
- **ARM build of manabrew-node** (for Oracle's free tier): is the work worth it?

## Full hosting status, 2026-11-02

Shape A chosen by the user, then **paused by the user the same day**. The Steam account for step M exists; Steam Guard and friending the players are still to do.

- **Free test passed:** the engine behind a delay proxy (`tmp/delay-proxy.js`, 60 ms each way + 0-20 ms) ran three-seat games with `tmp/kardur-check.js`: 7 of 8 passed 8 of 8 checks, the eighth didn't deal the cards the test needs, no engine errors. This covers the Forge link only, not TTS or a real network.
- **Not free:** a Windows GPU machine can't be tried for nothing. AWS's free plan appears not to allow GPU instances, so a first real test means a paid plan and about $2.
- **Scripts written, syntax-checked only:** `tools/vps-up.ps1`, `vps-down.ps1`, `night-up.ps1`, `night-down.ps1`. Their doctl and aws commands have never run against real accounts.
- **The droplet must run our images,** not the stock ones in the report's compose file: today `mtg-relay:exile` and
  `mtg-forge-node:exile`, built by `engine/build-images.sh` (`tools/setup-server.sh` runs it).

## tools/setup-server.sh, tested 2026-10-30

On a clean Ubuntu 24.04 container: Docker installed by the script, key created (mode 600), relay and Forge room started, and a
rules-check game played over the network through the relay, all checks passing. It refused a public address without `--public`,
and reported a stopped Docker service. Its image build was tested separately (a clean-clone build on Windows), not on Linux.
