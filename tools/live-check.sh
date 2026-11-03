#!/bin/sh
# live-check.sh <node tag> <test file>: a fresh test stack on 9444, beside the real one, then a tests/live_*.js check.
# A deal that can't set the scenario up never reaches it, so the check is dealt again, up to 4 times.
tag=${1:-table}
file=${2:-tests/live_phasing_check.js}
log=tmp/live-$(basename "$file" .js)-$tag.log
for try in 1 2 3 4; do
  docker rm -f mtg-test-relay mtg-test-node >/dev/null 2>&1
  docker run -d --name mtg-test-relay --network stack_default -p 127.0.0.1:9444:9443 -e MANABREW_SERVER_KEY=tts-local mtg-relay:exile >/dev/null
  sleep 2
  docker run -d --name mtg-test-node --network stack_default -e SELF_HOSTED_NODE_RELAY_URL=ws://mtg-test-relay:9443 \
    -e SELF_HOSTED_NODE_SERVER_KEY=tts-local -e SELF_HOSTED_NODE_ROOM_NAME=tts-test -e SELF_HOSTED_NODE_ENGINE_BACKEND=forge \
    -e SELF_HOSTED_NODE_FORMAT=commander -e SELF_HOSTED_NODE_MAX_PLAYERS=4 -e SELF_HOSTED_NODE_AUTO_START=true "mtg-forge-node:$tag" >/dev/null
  sleep 14
  node "$file" --timeout "${LIVE_TIMEOUT:-120}" > "$log" 2>&1
  grep -q "timed out" "$log" || break
done
docker rm -f mtg-test-relay mtg-test-node >/dev/null 2>&1
cut -c1-300 "$log"
