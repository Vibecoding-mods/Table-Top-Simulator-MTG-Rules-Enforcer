# Rent Forge cheaply, rent Windows only when needed

For this MTG Commander setup, the cheapest option that is also strong is **shape B**. The player with the best home upload hosts Tabletop Simulator, and the Node bridge runs on that same PC. The Forge engine and the Manabrew relay go on a **DigitalOcean CPU-Optimized 4 vCPU / 8 GB droplet** that you create from a saved snapshot each game night and delete afterwards. At ~15 hours a month that costs about **$2.50**. **Tailscale** connects the PC to the droplet, so neither machine needs an open port, a domain or a TLS certificate. **Shape A**, a rented Windows GPU desktop running TTS and the bridge, is the upgrade path if the host's home upload is what limits the game. Our pick there is an **AWS g4dn.xlarge on Windows Server 2022 in us-east-1**, reached over Amazon DCV. You still need the same Forge droplet, because Docker's WSL2 back end needs nested virtualization, and **neither AWS GPU instances nor Azure's NVadsA10 v5 support it**. That combination costs about **$21-23 a month** for the same 15 hours, and most of that is a Windows disk billed all month. Azure's NV6ads A10 v5 costs about the same per hour ($0.73) and is the best-documented alternative. airgpu ($0.65/h) is the easiest click-to-start option but has the weakest price sourcing. Shadow PC's session caps and idle shutdown make it unsafe as an unattended host. Spot instances can end a game mid-session. Hetzner US, once the default cheap VPS, now costs **$73.49/month for 4/8** after its June 2026 repricing. Lag in this project was mostly host freezes (fixed 2026-10-19), not bandwidth. So run the two free checks in "Step zero" before you pay for anything. The rest of this report is a complete, ordered build for both shapes, then security, cost control and a game-night routine.

## Shape B costs $2.50 a month; shape A costs about $23

Hosting TTS in the cloud means renting a whole Windows desktop with a GPU. TTS's minimum spec requires a DX10-class GPU ([PCGameCheck](https://pcgamecheck.com/game/tabletop-simulator)). No source shows it running on a CPU-only VM, and it has no dedicated or headless server ([Steam](https://steamcommunity.com/app/286160/discussions/0/1473095331499476124/)). In shape A, you pay roughly $0.70 an hour for a machine whose only job is to sit in the TTS lobby as host. In shape B, you pay about $0.07-0.125 an hour for a Linux box that does the CPU-heavy rules work, and an existing home PC does the hosting for free.

### What each provider costs at 15 hours a month

| Role | Provider and plan | Hourly | 15 h compute | Billed while off | ~Monthly total | Verdict |
|---|---|---|---|---|---|---|
| Forge + relay (both shapes) | **DigitalOcean CPU-Optimized 4/8 (dedicated vCPU)** | $0.125 | $1.88 | ~10 GB snapshot at $0.06/GB | **~$2.50** | **Pick** |
| Forge + relay | DigitalOcean Basic 4/8 (shared vCPU) | $0.0714 | $1.07 | same | ~$1.70 | Fine if AI think time doesn't jitter |
| Forge + relay | Hetzner US CPX31 (4/8 shared) | $0.1178 | $1.77 | full price until deleted | ~$2+ | Repriced from $24.99 to $73.49/mo |
| Forge + relay | Oracle Always Free A1 | $0 | $0 | $0 | $0 | Cut to 2 OCPU/12 GB; arm64 rebuild needed; idle reclaim |
| TTS host (shape A) | **AWS g4dn.xlarge, Windows (estimated)** | ~$0.71 | ~$10.65 | 80-100 GB gp3 at $0.08/GB | **~$19-21 + Forge** | **Pick** (scriptable, free DCV) |
| TTS host | Azure Standard_NV6ads_A10_v5, Windows | $0.730 | $10.95 | managed disk (price not verified) | ~$11 + disk + Forge | Equal alternative |
| TTS host | airgpu T4 | $0.65 | $9.75 | ~$7 for 100 GB | ~$16.75 + Forge | Easiest; prices from a third party |
| TTS host | Shadow PC Neo Lite | flat | — | included | $29.99 | 4 h sessions, 30 min idle shutdown |

Sources for the table: DigitalOcean's droplet pricing gives Basic 4/8 at **$0.07143/h**, CPU-Optimized 4/8 at **$0.125/h**, **per-second billing since 1 January 2026**, snapshots at **$0.06/GB-month**, and US regions in SFO, NYC, Richmond, Kansas City and Atlanta ([DigitalOcean](https://www.digitalocean.com/pricing/droplets)). Hetzner's own price-adjustment page has CPX31 at $73.49 and CCX23 at $102.99 ([Hetzner](https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/)). The Oracle cut is reported by [InfoQ](https://infoq.com/news/2026/07/oracle-cloud-free-tier-limits/) and the idle-reclaim rule is in [Oracle's docs](https://docs.oracle.com/en-us/iaas/Content/FreeTier/resourceref.htm). The manabrew-node image is linux/amd64 only. g4dn.xlarge is **$0.526/h** on the base OS ([Vantage](https://instances.vantage.sh/aws/ec2/g4dn.xlarge)). The ~$0.71 Windows figure is an estimate that adds a ~$0.046/vCPU-h Windows licence and matches one unofficial calculator ([course calculator](https://michael-lange-s-school.teachable.com/courses/2525668/lectures/55395584)), so check it in the AWS Pricing Calculator before you commit. The Azure price is identical in Central US, East US and East US 2 ([cloudprice.net](https://cloudprice.net/vm/Standard_NV6ads_A10_v5)). airgpu's figures come from a third-party comparison, because airgpu's own pricing page returned 404 ([getpulsesignal](https://getpulsesignal.com/compare/airgpu-vs-nasuni)). Shadow's plan limits are on its [offers page](https://shadow.tech/us/shadowpc/offers/). EBS gp3 storage is **$0.08/GB-month** and bills whether the instance runs or not ([cloudchipr](https://cloudchipr.com/blog/aws-ebs-pricing)).

### Why these providers and not others

Pay for **dedicated** vCPUs for Forge. Forge uses about three cores during a four-player game, and noisy neighbours on shared vCPUs show up as uneven AI think time. At 15 hours a month, the dedicated plan costs about 80 cents more. Two other problems rule out several cheap-looking alternatives. Vultr's A16 GPU plan was listed as "not available to order" on 2026-10-20 ([Spare Cores](https://sparecores.com/server/vultr/vcg-a16-6c-64g-16vram)). DigitalOcean's GPU droplets mention no Windows image ([DigitalOcean](https://digitalocean.com/products/gradient/gpu-droplets)).

For shape A, AWS beats Azure on two practical points. **Amazon DCV is free on EC2.** The only requirement is an S3 read permission on the instance role ([AWS DCV licensing](https://docs.aws.amazon.com/dcv/latest/adminguide/setting-up-license.html)). AWS also publishes an exact gaming-driver procedure for the T4 ([AWS gaming drivers](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/nvidia-gaming-driver.html)). Azure's advantages are a GRID licence included with every NVadsA10 v5 VM, 55 GiB RAM, and clearer price sourcing. Its table still lists "Nested Virtualization: Not Supported" ([Microsoft Learn](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/gpu-accelerated/nvadsa10v5-series)), so it doesn't remove the need for the droplet. If you already know Azure, the steps below translate one-for-one, except remote access: use Parsec instead of DCV.

### Docker cannot run on any of the GPU VMs

AWS added nested virtualization in February 2026 and named WSL2 and Docker Desktop as use cases. It is limited to C7i/M7i/R7i/C8i-class instances, and **no G-family GPU instance is on the list** ([AWS user guide](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/amazon-ec2-nested-virtualization.html), [AWS June 2026](https://aws.amazon.com/about-aws/whats-new/2026/06/nested-virtualization-intel-us-gov-cloud/)). Docker Desktop with Linux containers therefore cannot start on the GPU VM, and the Forge image is a Linux-only GraalVM native binary. This works in your favour: **both shapes use the identical Forge droplet**. You build it once, and changing shapes later only changes where TTS and the bridge run.

### Expected latency for the remote Forge link

Every engine round trip crosses the internet, an estimated 30-120 ms against Forge's 100-900 ms of think time. The bridge keeps talking to TTS over localhost on the External Editor ports (39998/39999) in both shapes, so the zero-cost return path the project measured stays intact. Pick the droplet region nearest to wherever the bridge runs. In shape B that is the host player's home. In shape A it is the AWS region: NYC or Richmond sit next to us-east-1 in northern Virginia.

## Step zero: two free checks before spending anything

The earlier investigation found that the friend's 10-second chop was the host freezing. Rewind snapshots took **2.7 s every ~10 s** because the engine's CustomDeck keys were huge, and that was fixed on 2026-10-19 ([local perf notes](local measurement notes (not published))). A cloud host running the old engine would have chopped the same way. First, play one session at home and ask the friend whether the chop is gone. While three players are connected, watch the TTS process's send rate in Windows Resource Monitor on the host. Community reports say upload is what matters for a TTS host ([Steam](https://steamcommunity.com/app/286160/discussions/0/1327844097123386340)). Second, cap the local Forge container at two cores with low priority and compare frame times in PresentMon. If host frames don't change, the droplet buys flexibility (any friend can host) but not smoothness. If the host's upload is saturated, go straight to shape A.

## The Forge droplet: one build that serves both shapes

This is the part both shapes share. The design goal is a server with **nothing listening on the public internet**. Tailscale makes an encrypted WireGuard link between your PC (or the cloud GPU VM) and the droplet. The relay listens only on that private link. A provider firewall outside the VM blocks everything else. Docker's own documentation explains why the provider firewall matters: published container ports are NAT-routed before ufw's chains see them, "effectively ignoring your firewall configuration" ([Docker packet filtering](https://docs.docker.com/engine/network/packet-filtering-firewalls/)). The relay's existing safeguard is the `MANABREW_SERVER_KEY` shared secret, and today it defaults to `tts-local` ([local compose.yml](../stack/compose.yml)). On a server that default has to become a long random string.

### Phase 1: accounts and keys on your Windows PC (20 minutes)

| # | Do this | Why |
|---|---|---|
| 1 | Create a DigitalOcean account and turn on two-factor login in account settings. Create a project called `manabrew`. | A leaked password can't run up a bill. |
| 2 | In PowerShell: `ssh-keygen -t ed25519 -C "manabrew-vps"`. Accept the default path and set a passphrase. Copy the public key: `Get-Content $env:USERPROFILE\.ssh\id_ed25519.pub \| Set-Clipboard`. | SSH keys replace passwords on the server. |
| 3 | In DigitalOcean, open Settings → Security → SSH Keys → Add, paste the key and name it `manabrew-pc`. | New droplets will trust only this key. |
| 4 | Create a free personal Tailscale account. Install Tailscale on the PC that will run the bridge (your home PC for shape B), sign in, and check that it shows "Connected". | This PC joins your private network ("tailnet"). |
| 5 | Install `doctl`, DigitalOcean's command-line tool (for example `winget install DigitalOcean.Doctl`; check the exact package name with `winget search doctl`). Create an API token in DigitalOcean → API and run `doctl auth init`. | This powers the one-click start and stop scripts. The token lives in doctl's user config and never goes in a script. |

The winget package name and the doctl commands throughout this report come from general knowledge, not a source fetched for this report. Run `doctl compute --help` once to confirm the flags before you rely on the scripts.

### Phase 2: create the droplet and its firewall (10 minutes)

Create a droplet with these settings:

- **Image:** Ubuntu 24.04 LTS. Docker supports both 24.04 and 26.04 ([Docker on Ubuntu](https://docs.docker.com/engine/install/ubuntu/)); use 26.04 only if DigitalOcean lists it.
- **Plan:** CPU-Optimized, 4 vCPU / 8 GB.
- **Region:** nearest the bridge PC.
- **SSH key:** `manabrew-pc`.
- **Hostname:** `manabrew-vps`.
- **Tag:** `manabrew`.

Then create a Cloud Firewall (Networking → Firewalls) and apply it to the **tag** `manabrew`, not to the droplet itself. A tag-based firewall attaches automatically to every future droplet restored from a snapshot. That is how DigitalOcean firewalls normally work (general knowledge), so check that the firewall lists the new droplet after your first restore. Give it these rules:

- **Inbound:** SSH (TCP 22) from your home IP only, for now.
- **Outbound:** leave the default allow-all, because Tailscale, apt and the GitHub image registry all need it.

Once Tailscale SSH works (Phase 5), delete the inbound SSH rule. The droplet then has **zero inbound rules**.

### Phase 3: first login and hardening (15 minutes)

Connect with `ssh root@<droplet-ip>`. Run `apt update && apt full-upgrade -y && reboot`. Ubuntu Server enables automatic security updates by default through `unattended-upgrades`, and **automatic reboot is off by default** ([Ubuntu automatic updates](https://ubuntu.com/server/docs/how-to/software/automatic-updates/)). Leave it off. A reboot during a game would cut every seat, because `bridge.js` logs "lost the engine connection" when the relay socket closes and does not reconnect ([local bridge.js](../bridge/bridge.js)). The droplet only exists on game nights and starts from a fresh boot each time, so it picks up kernel updates at that boot anyway.

Create your own user and switch off root and password logins. These are standard Ubuntu commands rather than ones fetched for this report:

```bash
adduser nick && usermod -aG sudo nick
rsync --archive --chown=nick:nick ~/.ssh /home/nick
printf "PermitRootLogin no\nPasswordAuthentication no\n" > /etc/ssh/sshd_config.d/99-hardening.conf
systemctl restart ssh
```

Before you close the root window, test `ssh nick@<droplet-ip>` in a second window. If that fails, you are locked out, and you would have to recover through DigitalOcean's web console.

### Phase 4: install Docker from Docker's own repository (10 minutes)

Follow Docker's official Ubuntu instructions ([Docker on Ubuntu](https://docs.docker.com/engine/install/ubuntu/)):

1. Install `ca-certificates` and `curl`.
2. Put Docker's GPG key in `/etc/apt/keyrings/docker.asc`.
3. Add the `docker.sources` repository file.
4. Run `sudo apt install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin`.

Then run `sudo usermod -aG docker nick`, log out and back in, and check that `docker run hello-world` prints its greeting. Docker Engine 29.x is current. Also cap log size so the disk can't fill up: write `{"log-driver":"local"}` to `/etc/docker/daemon.json` and restart Docker. That setting is general knowledge rather than from a fetched source.

### Phase 5: join the droplet to Tailscale (5 minutes)

Run `curl -fsSL https://tailscale.com/install.sh | sh`, then `sudo tailscale up --ssh`. Open the printed URL and approve the droplet ([Tailscale Linux install](https://tailscale.com/kb/1031/install-linux)). Then do two things in the Tailscale admin console:

1. Turn off **key expiry** for `manabrew-vps`. Otherwise the server silently drops off your tailnet when its key expires (standard Tailscale behaviour, not verified here).
2. Note its MagicDNS name (`manabrew-vps.<your-tailnet>.ts.net`) and its 100.x address from `tailscale ip -4`.

From the bridge PC, `ssh nick@manabrew-vps` should now work through Tailscale. When it does, remove the inbound SSH rule from the Cloud Firewall.

While your tailnet contains only your own devices, the default "allow all" policy is already private. If a friend's PC will host in shape B, invite them and tighten the policy so their device can reach only the relay port. This sketch follows Tailscale's documented ACL syntax ([Tailscale policy syntax](https://tailscale.com/kb/1337/policy-syntax)). Tailscale says it prefers its newer "grants" syntax, but documented ACLs still work. The policy editor validates the file when you save it.

```json
{
  "tagOwners": { "tag:forge": ["autogroup:admin"] },
  "acls": [
    { "action": "accept", "src": ["autogroup:admin"], "dst": ["*:*"] },
    { "action": "accept", "src": ["autogroup:member"], "dst": ["tag:forge:9443"] }
  ]
}
```

To use it, apply `tag:forge` to the droplet in the admin console.

### Phase 6: deploy the stack (20 minutes)

On the droplet, run `mkdir -p ~/manabrew && cd ~/manabrew`. Create a key with `openssl rand -hex 32` and put it in `.env` as `MANABREW_SERVER_KEY=<that string>`. Add `TS_IP=<the 100.x address>` and run `chmod 600 .env`. Then write `compose.yml`. It is the project's local stack with four changes:

- the browser `web` service is dropped (the bridge doesn't need it);
- images are pinned instead of `:latest`;
- the relay port is published **only on the Tailscale address**;
- the upstream self-host file's health check and 30-second stop grace are added ([local compose.selfhost.yml](../manabrew/compose.selfhost.yml)).

```yaml
services:
  relay:
    image: ghcr.io/witchesofthehill/manabrew-server:latest   # replace with @sha256:<digest> after first pull
    environment:
      MANABREW_SERVER_KEY: "${MANABREW_SERVER_KEY:?set it in .env}"
      FORGE_HEALTH_PORT: "9444"
      RUST_LOG: "manabrew_server=info"
    ports:
      - "${TS_IP}:9443:9443"          # tailnet only; never "9443:9443"
    healthcheck:
      test: ["CMD", "curl", "-fsS", "http://localhost:9444/health"]
      interval: 15s
      timeout: 3s
      retries: 3
    stop_grace_period: 30s
    restart: unless-stopped

  forge-room:
    image: ghcr.io/witchesofthehill/manabrew-node:latest     # pin likewise
    environment:
      SELF_HOSTED_NODE_RELAY_URL: "ws://relay:9443"
      SELF_HOSTED_NODE_SERVER_KEY: "${MANABREW_SERVER_KEY}"
      SELF_HOSTED_NODE_ROOM_NAME: "tts-commander"
      SELF_HOSTED_NODE_ENGINE_BACKEND: forge
      SELF_HOSTED_NODE_FORMAT: commander
      SELF_HOSTED_NODE_MAX_PLAYERS: "4"
      SELF_HOSTED_NODE_AUTO_START: "true"
      RUST_LOG: "self_hosted_node=info"
    depends_on: [relay]
    restart: unless-stopped
```

**Never** copy `compose.selfhost.yml` to the droplet as it is. It publishes `${RELAY_PORT:-9443}:9443` on every interface, and its default key is `forge`.

Run `docker compose pull`, then `docker compose up -d`. Check `docker compose ps`: the relay should say `healthy`. Then run `docker compose logs -f forge-room`. After the first good pull, record each image's digest with `docker inspect --format '{{index .RepoDigests 0}}' <image>` and write the `@sha256:` form into the file. With `:latest`, a later pull can silently bring a relay whose protocol no longer matches the bridge's client version.

`restart: unless-stopped` brings the containers back after every boot. If the relay is missing after a restore, the likely cause is Docker starting before Tailscale had assigned the 100.x address, which makes the port bind fail. This is an inference, not an observed failure. The first fix is to make Docker wait for Tailscale: run `sudo systemctl edit docker` and add `After=tailscaled.service` under `[Unit]`. The fallback is to publish `9443:9443` on all interfaces and rely on the Cloud Firewall, which blocks public 9443 while Tailscale traffic arrives inside its encrypted tunnel. That fallback has one weakness: only the firewall stands between the relay and the internet.

### Phase 7: point the bridge at the droplet and test (10 minutes)

The bridge reads `--relay` and `--key` from its command line or from `MTG_RELAY` and `MTG_KEY` in the environment ([local bridge.js](../bridge/bridge.js)). On the bridge PC, run `Test-NetConnection manabrew-vps -Port 9443` and look for `TcpTestSucceeded : True`. Then start the bridge:

```powershell
node bridge\bridge.js --relay ws://manabrew-vps:9443 --key <the 64-character key>
```

Plain `ws://` is fine here, because Tailscale's WireGuard tunnel already encrypts the link. In TTS the bridge should announce "[MTG] Bridge connected (relay ws://manabrew-vps:9443)". Play a few turns against bots to confirm prompts arrive.

### Phase 8: make a "golden" snapshot and switch to create-and-destroy (10 minutes)

DigitalOcean keeps billing a powered-off droplet: "To stop billing, you must destroy the Droplet" ([DigitalOcean billing](https://docs.digitalocean.com/products/droplets/details/pricing/)). The stack keeps no game data (no volumes), so you don't need a new snapshot every night. Make one **golden snapshot** after setup. Each game night, create a droplet from it, and afterwards delete the droplet. Take a new golden snapshot only when you change images or configuration. This is simpler and safer than snapshotting on every shutdown. A failed snapshot can never cause you to delete your only copy, and Tailscale's identity comes back with the disk, so `manabrew-vps` keeps the same name every night. That last point is an inference, and it holds only while one copy runs at a time.

Run `sudo poweroff` on the droplet. Then, on the PC:

```powershell
doctl compute droplet-action snapshot <droplet-id> --snapshot-name manabrew-golden-2026-10 --wait
```

Once the snapshot shows in the Images tab, delete the droplet. Keep `compose.yml` and a copy of `.env` on your PC as the real backup.

Save these two scripts in `tools\`. Their doctl syntax is unverified, so confirm `c-4` is the 4/8 CPU-Optimized size with `doctl compute size list` and use your own region slug.

```powershell
# vps-up.ps1: create tonight's Forge droplet from the newest golden snapshot
$snap = doctl compute snapshot list --resource droplet --format ID,Name --no-header |
        Select-String "manabrew-golden" | Select-Object -Last 1
$id = ($snap -split '\s+')[0]
doctl compute droplet create manabrew-vps --image $id --size c-4 --region nyc3 `
      --tag-names manabrew --ssh-keys <key-fingerprint> --wait
do { Start-Sleep 10 } until ((Test-NetConnection manabrew-vps -Port 9443).TcpTestSucceeded)
Write-Host "Forge relay is up."
```

```powershell
# vps-down.ps1: delete tonight's droplet (the golden snapshot stays)
doctl compute droplet delete manabrew-vps --force
doctl compute droplet list --format Name --no-header   # should print nothing
```

At per-second billing, a test cycle costs cents. Hetzner, by comparison, rounds every partial hour up ([Hetzner billing](https://docs.hetzner.com/cloud/billing/faq/)). DigitalOcean's restore time for a snapshot of this size has not been measured, so time your first one.

## The cloud TTS host is a Windows desktop you have to babysit

Shape A adds a rented Windows GPU VM that runs Steam, TTS and the bridge. It also joins the same tailnet and calls the same droplet. TTS needs **a real, unlocked, GPU-backed desktop session**. Three Windows behaviours work against that on a cloud VM:

- Windows uses its basic display adapter until a user logs in ([re:Post](https://repost.aws/questions/QU_km-yWjOTQy5xeROeM8QaA/issue-with-g4dn-instances-when-running-applications-built-using-opengl)).
- RDP sessions render through the Microsoft Basic Render Driver unless you change a Group Policy ([NVIDIA vGPU note](https://docs.nvidia.com/vgpu/19.0/known-issues/bug-no-id-no-gpu-utilization-windows-server-guests.html)).
- Disconnecting RDP locks the screen ([ui.vision forum](https://forum.ui.vision/t/without-connecting-ec2-vm/7384/2)).

The build below avoids all three with auto-logon, the NVIDIA gaming driver and Amazon DCV, which connects to the console session.

### Phase A1: the AWS account and the GPU quota (start 2 days ahead)

| # | Do this | Why |
|---|---|---|
| 1 | Create an AWS account. Turn on MFA for the root user. Create an admin user in IAM Identity Center (or IAM) and use only that from now on. | Standard account hygiene (general knowledge). |
| 2 | In Billing → Budgets, create a monthly cost budget of **$25** that emails you at 80% and 100%. | Catches a VM someone forgot to stop within a day. |
| 3 | Switch the console to **us-east-1**. In Service Quotas → EC2, request **"Running On-Demand G and VT instances" = 8**. Justify it as "occasional Windows GPU desktop for hosting a board game". | The default is **0** ([AWS quotas](https://docs.aws.amazon.com/ec2/latest/instancetypes/ec2-instance-quotas.html)). Ask for **On-Demand**, not Spot; a user who asked for the Spot quota was denied ([re:Post](https://repost.aws/questions/QUSPetOgBLTQuxHpy_ffhiAg/instance-launch-failed)). Allow 48 hours ([Vizrt guide](https://docs.vizrt.com/viz-now-admin-guide/1.3/Best-practices---How-to-Configure-Your-AWS-Accounts-for-Viz-Now.html)). |
| 4 | In IAM, create a role `tts-host-role` for EC2. Attach `AmazonS3ReadOnlyAccess` plus an inline policy allowing `s3:GetObject` on `arn:aws:s3:::dcv-license.us-east-1/*`. | Lets the VM download NVIDIA's driver and license DCV for free, with no access keys stored on it ([AWS gaming drivers](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/nvidia-gaming-driver.html), [DCV licensing](https://docs.aws.amazon.com/dcv/latest/adminguide/setting-up-license.html)). |
| 5 | In EC2, create a key pair and a security group `tts-host-sg`. Inbound: RDP 3389 from **My IP** only, for setup. Outbound: default allow-all. | Steam's required ports are all outbound ([Steam Support](https://help.steampowered.com/faqs/view/2EA8-4D75-DA21-31EB)). |

### Phase A2: launch the instance and install the gaming driver (1 hour)

Launch an instance with these settings:

- **Image:** "Microsoft Windows Server 2022 Base". GRID 17+ drivers dropped Server 2019 ([AWS GRID drivers](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/nvidia-GRID-driver.html)).
- **Type and purchase option:** g4dn.xlarge, On-Demand.
- **Root disk:** 80-100 GB gp3. The 30 GB default is too small for Windows updates, Steam, TTS and the card cache, and a disk can grow but never shrink.
- **IAM role:** `tts-host-role`.
- **Security group:** `tts-host-sg`.
- **Protection:** termination protection on.
- **IP:** auto-assigned public IP, and **no Elastic IP**. Friends join through Steam, so nobody needs a fixed address, and an Elastic IP bills about $3.65 a month even while the VM is stopped ([AWS IPv4 charge](https://aws.amazon.com/blogs/aws/new-aws-public-ipv4-address-charge-public-ip-insights)).

Install everything on C:. The g4dn's NVMe instance-store drive is **erased on every stop** ([AWS instance lifecycle](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-instance-lifecycle.html)).

Use "Get Windows password" with your key pair, connect by RDP, and run Windows Update until nothing is left. Then install the **NVIDIA gaming driver**, not the public Tesla driver. Tesla runs in compute-only TCC mode, with no graphics ([AWS NVIDIA drivers](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/install-nvidia-driver.html)). The steps follow AWS's procedure ([AWS gaming drivers](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/nvidia-gaming-driver.html)):

1. In PowerShell, download the bucket `nvidia-gaming`, prefix `windows/latest`, to the Desktop with `Get-S3Object` / `Copy-S3Object`.
2. Run the installer and reboot.
3. From a **64-bit** PowerShell, register the driver:
   ```powershell
   New-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Services\nvlddmkm\Global" -Name "vGamingMarketplace" -PropertyType DWord -Value 2
   ```
   AWS notes that its Tools for PowerShell default to 32-bit, where this command fails.
4. Fetch the licence certificate. For drivers 591.59 or later:
   ```powershell
   Invoke-WebRequest -Uri "https://nvidia-gaming.s3.amazonaws.com/GridSwCert-Archive/GridSwCert_2026_03_02.cert" -OutFile "$Env:PUBLIC\Documents\GridSwCert.txt"
   ```
5. Reboot.
6. Run `nvidia-smi.exe -q` from under `C:\Windows\System32\DriverStore\FileRepository\`. It must report "NVIDIA Cloud Gaming" and "License Status: Licensed".

Repeat the certificate step whenever you upgrade the driver, because the certificate file changes by driver version.

### Phase A3: remote access, auto-logon and a desktop that never locks (45 minutes)

Install the Amazon DCV Server for Windows from AWS's download page. The defaults below come from general knowledge, because the installer steps were not fetched: DCV listens on **8443 TCP and UDP**, starts a console session automatically on Windows, and has a browser client at `https://<ip>:8443`. Add 8443 TCP+UDP from My IP to `tts-host-sg`, connect with the DCV client, and once that works, **delete the RDP rule**. Parsec is the fallback. It lists the g4dn.xlarge as supported cloud hardware, but on a monitor-less VM it needs its virtual display driver ([Parsec cloud guide](https://support.parsec.app/hc/en-us/articles/32381875912468-Cloud-Workstation-Setup-Guide)).

Inside DCV, set up the desktop TTS will run in:

1. Create a local standard user `ttshost` with a long random password.
2. Run Sysinternals **Autologon64.exe** to log `ttshost` in at every boot.
3. Set Screen and Sleep to **Never**, turn off the screensaver and "require sign-in after wake", and choose the High performance power plan.
4. In Windows Update, set active hours covering game nights.

If you ever have to use RDP, enable the Group Policy "Use the hardware default graphics adapter for all Remote Desktop Services sessions" so the GPU stays in use ([Thomas-Krenn](https://www.thomas-krenn.com/en/wiki/Activation_of_NVIDIA_vGPU_for_RDS_Sessions_on_Windows_Server)). Leave RDP through an admin shortcut that runs `tscon %sessionname% /dest:console`, not the window's X button. The X button locks the screen, and the tscon command hands the session back to the console still unlocked. On Windows Server 2022, repeated RDP reconnects can also exhaust GPU memory and leave a black screen until the VM restarts ([NVIDIA bug 3583766](https://docs.nvidia.com/vgpu/19.0/known-issues/bug-3583766-multiple-rdp-reconnections-use-all-frame-buffer.html)).

### Phase A4: a dedicated Steam host account (30 minutes)

The VM must be logged into a Steam account that owns TTS, and that account can't play elsewhere at the same time. Steam Families doesn't get around this: if two members want the same game simultaneously, "someone else in the family will need to purchase a copy" ([VGC](https://videogameschronicle.com/news/steam-launches-families-allowing-users-to-share-games)). Set the account up like this:

1. Create a separate account (for example `ourgroup-tts-host`) with its own email address, and buy or gift it a copy of TTS.
2. Add the account to your **Steam Mobile app**, which can hold Steam Guard for several accounts ([Steam Support](https://help.steampowered.com/en/faqs/view/6891-E071-C9D9-0134)).
3. On the VM, install Steam on C:, sign in with "Remember me" ticked, approve the login on your phone, and enable "Run Steam when my computer starts".
4. Friend the host account with every player.

Keep your main Steam account off the cloud machine. Nobody has confirmed whether Steam asks for Steam Guard again after AWS moves a stopped instance to new hardware, so keep your phone nearby on the first few nights.

### Phase A5: TTS, the bridge and Tailscale on the VM (45 minutes)

Install TTS from the host account. Launch it once to accept the first-run prompts, and set graphics low. Subscribe to the table or copy the save into `Documents\My Games\Tabletop Simulator\Saves`. **Load the save once** so every card image is cached on disk before game night.

Install Node.js LTS. Copy the `bridge` folder to `C:\mtg-bridge` and run `npm ci`. Install Tailscale, signed into the same tailnet. Then create two Task Scheduler tasks, both "At log on of ttshost" and "Run only when user is logged on":

- **Start TTS**: runs `explorer.exe steam://rungameid/286160` after a 60-second delay.
- **MTG Bridge**: runs `"C:\Program Files\nodejs\node.exe" C:\mtg-bridge\bridge.js --relay ws://manabrew-vps:9443 --key <key>` in `C:\mtg-bridge`, restarting every minute on failure.

Both must run in the user's session. A Windows service runs in session 0, which has no desktop. To keep the key off the command line, set `MTG_KEY` as a user environment variable for `ttshost` instead. No documented TTS launch flag hosts a server or loads a save automatically, so clicking Host and loading the save stays a manual step each night.

Networking needs **no inbound rule for players**. Since v14.2, TTS traffic is encrypted and routed through Steam relays ([TTS v14.2 notes](https://tabletopsimulator.com/news/patch-notes/v14-2-public-beta-updated-steam-p2p-networking-and-engine)). Older forum advice to open port 11155 predates that change. If you test 11155 anyway, open it in both the security group and Windows Firewall, and allow TTS on **Public** networks, because Windows classifies EC2 networks as Public.

### Phase A6: three layers of automatic shutdown, and a test (30 minutes)

Shutting down from inside Windows **stops** the EC2 instance by default ([AWS instance lifecycle](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-instance-lifecycle.html)), and a stopped instance bills no compute. Stack three safety nets on top of that behaviour:

1. **A nightly backstop.** A Task Scheduler task runs `shutdown /s /t 300` every day at 03:00.
2. **An idle alarm.** In the EC2 console, open the instance's Actions → Monitor and troubleshoot → Manage CloudWatch alarms, and create an alarm with action **Stop**, for example average CPU ≤ 5% for 12 periods of 5 minutes ([AWS alarm actions](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/UsingAlarmActions.html)). Unity keeps rendering in an idle lobby, so this alarm catches a crashed TTS rather than an idle one.
3. **The $25 budget email.**

A future improvement is for the bridge to count players through the External Editor API and shut the VM down after 30 minutes with only the host seat present. That is a design idea, not existing code.

Then test the whole chain. Stop the instance and start it again. Auto-logon, Steam, TTS and the bridge should all come up without help. Connect over DCV, host, and have a friend join. When it all works, take an **EBS snapshot** of the root volume, about $0.05/GB-month ([cloudchipr](https://cloudchipr.com/blog/aws-ebs-pricing)). If you ever need it, restore with "Replace root volume" rather than by launching a new AMI. A custom AMI used with the gaming driver must be sysprepped ([AWS gaming drivers](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/nvidia-gaming-driver.html)).

For one-click control, create an IAM user that is allowed only `ec2:StartInstances`, `ec2:StopInstances` and `ec2:DescribeInstances` on this one instance. Put its credentials in an AWS CLI profile called `ttsnight`, and combine both machines into one script. The AWS Console mobile app can also start and stop the instance from a phone.

```powershell
# night-up.ps1 (shape A): start the GPU host and create the Forge droplet together
aws ec2 start-instances --instance-ids i-XXXXXXXX --profile ttsnight
& tools\vps-up.ps1
# night-down.ps1 is the mirror image: aws ec2 stop-instances ... ; vps-down.ps1
```

## Security comes from having nothing to attack

The whole build rests on one idea: **nothing faces the public internet except outbound connections**. The table lists each exposed surface and what guards it.

| Surface | Shape | Protection | What happens if you skip it |
|---|---|---|---|
| Relay port 9443 | both | Bound to the Tailscale IP; DO Cloud Firewall has no inbound rules; 64-character `MANABREW_SERVER_KEY` | Bots scan it, and only `tts-local` stands in the way |
| SSH to droplet | both | Tailscale SSH; root and password login off; keys only | Brute-force noise or a takeover |
| Docker vs ufw | both | Trust the provider firewall, not ufw; never publish `9443:9443` | Ports bypass ufw ([Docker](https://docs.docker.com/engine/network/packet-filtering-firewalls/)) |
| Image supply | both | Pin `@sha256:` digests; update deliberately | A silent protocol mismatch with the bridge |
| DCV 8443 | A | Security group allows your home IP only; RDP rule deleted after setup | A public remote-desktop login page |
| Windows login | A | Long random passwords; `ttshost` is a standard user; Autologon stores the password LSA-encrypted (general knowledge) | Anyone who reaches the desktop owns the box |
| Steam | A | A dedicated host account with Steam Guard on your phone | Your main account and library sit on a cloud VM |
| AWS account | A | Root MFA; admin through IAM; start/stop user limited to one instance; $25 budget | A leaked key mines crypto on GPUs at your expense |
| DO account | both | 2FA; API token only in doctl's config, never in the repo | Same |

You don't need Cloudflare Tunnel or Caddy plus a domain unless friends' **browsers** must reach the relay. The upstream Manabrew project fronts its public relay with Caddy ([local ops/Caddyfile](../manabrew/ops/Caddyfile)). Cloudflare can restart edge servers on code releases, which "terminates WebSockets connections" ([Cloudflare WebSockets](https://developers.cloudflare.com/network/websockets/)). That is a poor fit for a bridge that doesn't reconnect.

## Game night runs on two scripts and one checklist

### Shape B: a player hosts at home

| When | Step |
|---|---|
| T−15 min | Host runs `vps-up.ps1` and waits for "Forge relay is up." Plug the host PC into the router with a cable, close upload-heavy apps, and turn VPNs off. |
| T−10 | Start the bridge with `--relay ws://manabrew-vps:9443 --key ...`. Launch TTS and load the save **before anyone joins**. Pushing scripts or using Save & Play mid-session reloads the table and wipes it. |
| T−5 | Host the server with a password and invite friends through Steam. Let first-time joiners finish loading card images. |
| Play | Don't update or restart anything on the droplet. A relay restart cuts every seat, and the bridge doesn't reconnect. |
| End | Close TTS and the bridge, then run `vps-down.ps1`. Check that the DO dashboard lists **zero droplets**. |

### Shape A: the cloud GPU host

| When | Step |
|---|---|
| T−20 min | Run `night-up.ps1`. The VM boots, logs `ttshost` in, and starts Steam, TTS and the bridge. The droplet comes up in parallel. If AWS reports "insufficient capacity", retry in a few minutes or try another Availability Zone. |
| T−10 | Connect with the DCV client. Check that the bridge's chat line says it connected. Click Host (password on), load the save, and invite friends from the host account. |
| T−5 | **Disconnect DCV.** A remote-desktop stream left open all evening costs egress and GPU time. Everyone, the organizer included, plays from their own PC with their own Steam account. |
| End | Run `night-down.ps1`. Check that EC2 shows **stopped** and DO shows no droplets. The 03:00 shutdown, the CloudWatch alarm and the budget email cover the night you forget. |

Monthly maintenance takes about 15 minutes, on a day with no game. In shape A, start the VM, install Windows and Steam updates, and stop it. For both shapes, when you want newer Manabrew images, restore the droplet, change the pinned digests, run `docker compose pull && docker compose up -d`, play a bot test, and take a new golden snapshot. Then delete the old snapshot so it stops billing.

## What remains unverified

Several facts this plan rests on were estimated or taken from secondary sources:

- **Prices.** No official AWS page confirmed the g4dn Windows hourly rate. Azure's managed-disk prices weren't found. airgpu's prices come only from a third party.
- **Commands.** The doctl and DCV commands are general knowledge, and so are the Docker-after-Tailscale ordering fix and keeping a Tailscale identity through a snapshot restore. Each takes a minute to confirm on the first build.
- **Untested behaviour.** Nobody has checked whether Steam re-prompts for Steam Guard after an EC2 stop and start, or whether a CPU alarm fires reliably on an idle TTS host. No TTS-specific comparison of DCV and Parsec was found.
- **Forge memory.** Forge's RAM use under a live four-player Commander game hasn't been measured. 8 GB is generous next to the ~250 MB idle footprint, so this is low risk.
- **The bridge.** `bridge.js` registers no reconnect logic on relay close. That makes "never touch the server mid-game" a hard rule until a ping-and-reconnect loop is added.

## Conclusion

Neither shape needs a premium provider. Each needs three things: a server with no public ports, a bill that stops when the game does, and a bridge that never leaves TTS's localhost. The droplet does more than run the engine. Once Forge lives off any one PC, choosing a host becomes a nightly decision rather than a hardware fact: whoever has the cleanest upload hosts, at about $2.50 a month. A cloud GPU host turns that same flexibility into a permanent "best connection" for roughly ten times the price, plus the upkeep of a Windows desktop.

The step that most improves both shapes isn't a hosting purchase. It is teaching `bridge.js` to send WebSocket pings and reconnect when the relay drops. At present a five-second network blip or an accidental container restart ends a two-hour Commander game. Once the bridge can survive that, the remaining risks are things an AWS budget and a delete command already handle.
