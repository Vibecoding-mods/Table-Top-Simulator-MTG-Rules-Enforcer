# Cloud hosting spec, option 1: everything in one AWS account (2026-11-10)

Status: **spec only.** Nothing is built and no AWS account exists yet. This replaces the DigitalOcean droplet in shape A
of [server-setup-spec.md](server-setup-spec.md) with a small Linux machine in the same AWS account. The background,
sources and full click-by-click build are in `reports/Cloud hosting setup step by step.md`.

## 1. What runs where

```
 Friends' PCs (TTS, Steam invite)
        │  TTS game traffic (Steam relay)
        ▼
 ┌──────────── AWS us-east-1, one VPC, one subnet ────────────┐
 │                                                            │
 │  tts-host: g4dn.xlarge, Windows Server 2022, 100 GB gp3    │
 │    Steam (alt account) + TTS + table save                  │
 │    MTG Companion + bridge, relay = ws://10.0.1.20:9443     │
 │    Amazon DCV (remote desktop for the organiser)           │
 │                   │ private network only                   │
 │                   ▼                                        │
 │  forge: c7a.large, Ubuntu 24.04, 20 GB gp3, 10.0.1.20      │
 │    Docker: relay + Forge room (our images)                 │
 │                                                            │
 └────────────────────────────────────────────────────────────┘
        ▲  Start / Stop / Status (AWS API), DCV from home
 Organiser's PC: MTG Companion, Cloud mode
```

- **tts-host** replaces the home PC as the TTS host. It's the only machine friends connect to, through Steam.
- **forge** runs the engine. It's reachable only from tts-host, on the private network.
- **The organiser's PC** only switches the two machines on and off and opens the remote desktop. Nobody else needs AWS.

## 2. Why this beats the droplet

- **A stopped EC2 machine doesn't bill compute,** only its disk. A DigitalOcean droplet bills while off, so the old plan
  had to snapshot, delete and re-create it every night. Here both machines are simply stopped and started.
- **There's no Tailscale.** The two machines share a private network, and forge has no inbound rule from the internet.
- **There's one account and one bill.** The idle shutdown and budget alarm cover both machines.
- **Lag is under a millisecond** between the machines, against tens of milliseconds to an outside provider.

## 3. Cost

Prices, checked 2026-11-10 on instances.vantage.sh for us-east-1 Linux:
- g4dn.xlarge: $0.526/h;
- c7a.xlarge (4 vCPU, 8 GB): $0.205/h;
- c7a.large: half of the xlarge, the same family.

The Windows rate for g4dn.xlarge is still the **estimate of about $0.71/h**. Check it in the AWS Pricing Calculator
before you commit.

| Item | Per hour of play | Per month, always |
|---|---|---|
| tts-host g4dn.xlarge, Windows | ~$0.71 (estimate) | — |
| forge c7a.large, 2 vCPU / 4 GB | ~$0.10 | — |
| 2 public IPv4 addresses, only while running | $0.01 | — |
| Disks: 100 GB + 20 GB gp3 at $0.08/GB | — | ~$9.60 |
| One snapshot of each disk (backup) | — | ~$2–5 |
| **Total** | **~$0.82/h** | **~$12–15** |

- A 4-hour game night costs about $3.30.
- 15 hours a month costs about $24–27, the same as the old A+B plan, with fewer moving parts.
- Leaving both machines on all month would cost about $600. Section 6 is what prevents that.
- c7a.large's 2 cores match what the engine has at home today (2 WSL cores). If AI turns feel slow with 3 AI players,
  change it to c7a.xlarge: one setting while stopped, +$0.10/h.

## 4. Security

| Thing | Rule |
|---|---|
| forge, inbound | port 9443 **only from tts-host's security group**; port 22 only from tts-host's security group (for updates); nothing from the internet |
| tts-host, inbound | DCV 8443 TCP+UDP **only from the organiser's current home IP**; no RDP after setup |
| Home IP changes | On **Start**, the companion replaces the DCV rule with the PC's current IP (one scoped API call) |
| Relay key | a long random `MANABREW_SERVER_KEY` on forge, and the same key in the bridge's settings on tts-host |
| AWS root account | MFA on, never used day to day |
| Companion's AWS key | an IAM user that can only start, stop and describe the two machines tagged `mtg`, and edit the one DCV rule. Stored encrypted with DPAPI (the same as the update token). It can't create machines, read disks or touch billing. |
| Machine admin | AWS Systems Manager Session Manager (no SSH from the internet), or SSH from tts-host over the private network |
| Secrets in the repo | none. Keys live only on the organiser's PC and on the machines. |

AWS automatically encrypts traffic between machines on its newer hardware. Check that g4dn and c7a are both on that
list before relying on it. Either way, the traffic never leaves the private network, and the relay key still applies.

## 5. Game night, from the organiser's side

1. Companion → **Cloud** → **Start game night**:
   - updates the DCV rule to the current IP;
   - starts forge, then tts-host;
   - waits for forge's relay health check and for the bridge on tts-host to report `ttsConnected`, about 3–5 minutes
     for the Windows boot.
2. **Open remote desktop:** the companion launches the DCV client at tts-host's address. Load "MTG Table (rules engine)",
   host with a password and invite friends from the alt Steam account.
3. **Disconnect DCV.** The organiser plays from their own PC with their own Steam account, like everyone else.
4. **End game night:** stops tts-host, then forge, and shows tonight's running cost.

The companion's status panel shows each machine's state (stopped, starting, running), the hours used this month, and an
estimated bill.

## 6. Shutdown nets (so a forgotten night can't bill for a month)

1. **The companion's Stop button** (normal case).
2. **An idle stop on tts-host:** a CloudWatch alarm on CPU below 5% for 30 minutes uses the built-in EC2 "stop"
   action, with no Lambda. A second alarm stops forge when tts-host has been stopped for 10 minutes. Or simpler: forge
   stops itself when the relay has had no connection for 30 minutes (a systemd timer).
3. **A nightly 05:00 stop** of both (EventBridge Scheduler).
4. **An AWS Budget** e-mail alert at $30 and $50 a month.

## 7. One-time setup

**The organiser's part (account actions):**
1. Create the AWS account, turn on root MFA, and add a payment card.
2. Request the GPU quota: "Running On-Demand G and VT instances" ≥ 4 in us-east-1. Allow about 2 days.
3. Run the CloudFormation template (section 8) from the AWS console, and copy the companion's access key from its
   output into the companion.
4. Sign the alt Steam account in once on tts-host over DCV, with Steam Guard by the mobile app.

**Automated by our code:**
- **The template creates:**
  - the VPC, the subnet and both security groups;
  - both machines, with fixed private IPs and tags;
  - the instance role (for the NVIDIA gaming driver and the DCV licence);
  - the restricted IAM user, the alarms, the schedule and the budget.
- **tts-host's first-boot script installs:**
  - the NVIDIA gaming driver and Amazon DCV;
  - auto-logon and never-lock;
  - Steam, the MTG Companion package (bridge, table save) and its start-at-logon.
  - TTS itself comes from Steam after the alt account signs in.
- **forge's first-boot script:**
  - installs Docker;
  - gets the engine images by building them itself with `tools/setup-server.sh` (`engine/build-images.sh`), as Own server mode does; an image push from tts-host over SSH was assumed in the first draft of this spec and **does not exist** (Own server mode never pushes images; checked 2026-11-27);
  - starts the stack with `restart: always`, bound to the private IP.
- **Updates:** the auto-update on tts-host downloads the new release as on any PC. When the engine images change, it
  must get them to forge over the private network before the next game: that step is **not built** (see the first-boot line above; forge would rebuild with `setup-server.sh`, or a push has to be written).

## 8. Work for us

| Piece | Hours | Notes |
|---|---|---|
| CloudFormation template (VPC, SGs, 2 machines, IAM user + role, alarms, schedule, budget) | 4–6 | Checked with `cfn-lint`; first real run is the organiser's |
| tts-host first-boot PowerShell (driver, DCV, auto-logon, Steam, companion) | 3–5 | Driver steps from AWS's published gaming-driver guide |
| forge first-boot script + getting new engine images to forge (`setup-server.sh` builds them; a push over SSH does not exist and would be new work, add 3–5 h if wanted) | 2–3 | `setup-server.sh` already does most of it |
| Companion **Cloud** mode: Start / Stop / Status / Open DCV / cost readout, AWS calls signed in-app (SigV4, no AWS CLI needed) | 8–12 | Plus tests against a recorded fake AWS endpoint |
| Bridge and relay settings on tts-host (relay address + key) | 1 | `MTG_RELAY` and `MTG_KEY` exist already |
| **Total** | **18–27 h** | About 20–30% of a week's usage |

The old `tools/night-up.ps1` and `night-down.ps1` become fallbacks; the companion does their job.

## 9. Acceptance tests

1. Template: `cfn-lint` clean. Live: a stack created and deleted cleanly, and forge has no public inbound (an outside
   port scan of 9443 and 22 is closed).
2. Start game night → table hosted in under 6 minutes, bridge connected to forge, a test game against 3 AI to turn 5.
3. A friend joins over Steam and plays a full game. `tools/net-upload-meter.ps1` on tts-host shows no upload saturation,
   and each player's frame times are no worse than with the home host.
4. Each shutdown net fires once on purpose: idle alarm, 05:00 schedule, budget e-mail.
5. A stop/start cycle: auto-logon, Steam, TTS and the bridge come back without help. **Watch for Steam Guard asking
   again** (untested anywhere).
6. The companion's AWS key can't do anything else: describe/start/stop on an untagged machine is refused, and so are
   creating a machine and reading S3.

## 10. Open questions

- The real Windows hourly rate for g4dn.xlarge.
- Whether Steam Guard re-prompts after a stop and start.
- Whether c7a.large is enough for 3 AI players, or it needs xlarge (test 2 measures it).
- DCV against Parsec for loading the table: DCV is free on EC2 and is the default.
