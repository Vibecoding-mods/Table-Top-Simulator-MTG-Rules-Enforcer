#!/usr/bin/env bash
# Sets up a Linux server (Ubuntu or Debian) to run the rules engine in Docker: the relay and one Forge room.
# Players don't connect to it; only the host's bridge does. TTS and the bridge stay on the host's PC.
#
#   sudo bash tools/setup-server.sh [--bind <ip>] [--public] [--seats <n>] [--no-install] [--no-build] [--dry-run]
#
# Safe to run again: it keeps the existing key and skips what's already done.
# The relay is never opened to the internet by accident: it binds to your Tailscale address if there is one, otherwise to
# 127.0.0.1. Any address that reaches the internet takes --public, which you'd want only behind your own firewall.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
envfile="$root/stack/.env"
bind="" public=0 seats=4 install=1 build=1 dry=0

while [ $# -gt 0 ]; do
  case "$1" in
    --bind) bind="${2:?--bind needs an address}"; shift 2 ;;
    --public) public=1; shift ;;
    --seats) seats="${2:?--seats needs a number}"; shift 2 ;;
    --no-install) install=0; shift ;;
    --no-build) build=0; shift ;;
    --dry-run) dry=1; shift ;;
    -h|--help) sed -n 2,9p "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $1 (try --help)" >&2; exit 2 ;;
  esac
done

run() { if [ "$dry" = 1 ]; then echo "  would run: $*"; else "$@"; fi; }
step() { echo; echo "== $*"; }

case "$seats" in ''|*[!0-9]*) echo "--seats must be a number" >&2; exit 2 ;; esac

# 1. Where the relay listens
step "Relay address"
if [ -z "$bind" ] && command -v tailscale >/dev/null 2>&1; then bind="$(tailscale ip -4 2>/dev/null | head -1 || true)"; fi
case "$bind" in
  "") bind=127.0.0.1; echo "No Tailscale address found: binding to 127.0.0.1, reachable only from this server." ;;
  127.*|100.6[4-9].*|100.[7-9][0-9].*|100.1[01][0-9].*|100.12[0-7].*|10.*|192.168.*|172.1[6-9].*|172.2[0-9].*|172.3[01].*) echo "Binding to $bind (private)." ;;
  *) if [ "$public" != 1 ]; then echo "$bind may be reachable from the internet. Use Tailscale, or pass --public if you mean it." >&2; exit 2; fi
     echo "WARNING: binding to $bind. Anyone who can reach port 9443 still needs the key, but keep a firewall in front of it." ;;
esac

# 2. Docker and git
step "Docker"
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  echo "Already installed: $(docker --version)"
elif [ "$install" = 1 ]; then
  if [ "$(id -u)" != 0 ] && [ "$dry" != 1 ]; then echo "Installing Docker needs root: run this with sudo." >&2; exit 1; fi
  run sh -c 'curl -fsSL https://get.docker.com | sh'
else
  echo "Docker with the compose plugin is missing, and --no-install was given." >&2; exit 1
fi
command -v git >/dev/null 2>&1 || run sh -c 'apt-get update -qq && apt-get install -y -qq git'
if [ "$dry" != 1 ] && ! docker info >/dev/null 2>&1; then
  systemctl enable --now docker >/dev/null 2>&1 || true
  sleep 3
  if ! docker info >/dev/null 2>&1; then echo "Docker is installed but not running. Start it, then run this again." >&2; exit 1; fi
fi

# 3. The key, kept in stack/.env (never committed)
step "Secret key"
if [ -f "$envfile" ] && grep -q '^MANABREW_SERVER_KEY=' "$envfile"; then
  echo "Keeping the key in stack/.env."
else
  key="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  if [ "$dry" = 1 ]; then echo "  would write a new key to stack/.env"; else
    ( umask 077; printf 'MANABREW_SERVER_KEY=%s\n' "$key" >> "$envfile" )
    echo "New key written to stack/.env."
  fi
fi
if [ "$dry" != 1 ]; then
  touch "$envfile"; chmod 600 "$envfile"
  for pair in "RELAY_BIND=$bind" "SEATS=$seats"; do
    name="${pair%%=*}"
    sed -i "/^$name=/d" "$envfile"
    echo "$pair" >> "$envfile"
  done
fi

# 4. The engine images
step "Engine images"
if docker image inspect mtg-forge-node:exile mtg-relay:exile >/dev/null 2>&1; then
  echo "Already built."
elif [ "$build" = 1 ]; then
  echo "Building from source, about 20 minutes."
  run bash "$root/engine/build-images.sh"
else
  echo "Images are missing, and --no-build was given." >&2; exit 1
fi

# 5. Start (no web client on a server)
step "Starting the relay and the Forge room"
run docker compose -f "$root/stack/compose.yml" up -d relay forge-room

if [ "$dry" != 1 ]; then
  step "Checking the relay"
  ok=0
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    if docker compose -f "$root/stack/compose.yml" ps --status running --services 2>/dev/null | grep -q '^relay$'; then ok=1; break; fi
    sleep 2
  done
  if [ "$ok" != 1 ]; then echo "The relay didn't start. See: docker compose -f stack/compose.yml logs relay" >&2; exit 1; fi
  echo "Running."
fi

step "Done"
cat <<EOF
On the host's PC, start the bridge pointed at this server:

  node bridge/bridge.js --relay ws://$bind:9443 --key <the key in stack/.env>

The host's PC needs a route to $bind (join the same Tailscale network).
Stop the engine:  docker compose -f stack/compose.yml down
EOF
