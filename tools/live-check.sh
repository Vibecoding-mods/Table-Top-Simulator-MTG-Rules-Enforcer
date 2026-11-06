#!/bin/sh
# live-check.sh <node tag> <test file>: a fresh test stack beside the real one, then a tests/live_*.js check.
# LIVE_ARGS goes to the check as it is (the keyword sweep: LIVE_ARGS="--sweep tests/keyword-sweep.json").
# LIVE_STACK=<n> runs stack n (containers mtg-test-*-<n>, port 9444+n, log tmp/live-<check>-<tag>-<n>.log), so two
# checks can run at once; stack 0 keeps the old names, port 9444 and log.
# A deal that can't set the scenario up never reaches it, so the check is dealt again, up to 4 times.
tag=${1:-table}
file=${2:-tests/live_phasing_check.js}
n=${LIVE_STACK:-0}
if [ "$n" = 0 ]; then sfx=""; else sfx="-$n"; fi
port=$((9444 + n))
relay=mtg-test-relay$sfx
node_c=mtg-test-node$sfx
log=tmp/live-$(basename "$file" .js)-$tag$sfx.log
for try in 1 2 3 4; do
  docker rm -f "$relay" "$node_c" >/dev/null 2>&1
  docker run -d --name "$relay" --network stack_default -p 127.0.0.1:$port:9443 -e MANABREW_SERVER_KEY=tts-local "mtg-relay:${LIVE_RELAY:-exile}" >/dev/null
  sleep 2
  docker run -d --name "$node_c" --network stack_default -e SELF_HOSTED_NODE_RELAY_URL=ws://$relay:9443 \
    -e SELF_HOSTED_NODE_SERVER_KEY=tts-local -e SELF_HOSTED_NODE_ROOM_NAME=tts-test -e SELF_HOSTED_NODE_ENGINE_BACKEND=forge \
    -e SELF_HOSTED_NODE_FORMAT=commander -e SELF_HOSTED_NODE_MAX_PLAYERS=4 -e SELF_HOSTED_NODE_AUTO_START=true "mtg-forge-node:$tag" >/dev/null
  sleep 14
  node "$file" --relay "ws://127.0.0.1:$port" --timeout "${LIVE_TIMEOUT:-120}" $LIVE_ARGS > "$log" 2>&1
  grep -qE "timed out|^stopped:" "$log" || break
done
docker rm -f "$relay" "$node_c" >/dev/null 2>&1
cut -c1-300 "$log"
