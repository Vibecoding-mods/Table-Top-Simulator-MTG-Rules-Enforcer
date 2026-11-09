#!/bin/sh
# live-check.sh <node tag> <test file>: a fresh test stack beside the real one, then a tests/live_*.js check.
# LIVE_ARGS goes to the check as it is (the keyword sweep: LIVE_ARGS="--sweep tests/keyword-sweep.json").
# LIVE_STACK=<n> runs stack n (containers mtg-test-*-<n>, port 9444+n, log tmp/live-<check>-<tag>-<n>.log), so two
# checks can run at once; stack 0 keeps the old names, port 9444 and log.
# LIVE_RELAY=<tag> picks the relay image; by default mtg-relay:<node tag>, and with no such image it must be given
# (LIVE_RELAY=exile for a node image built without a relay of its own).
# LIVE_ROOM_WAIT=<s> (default 60): how long the node gets to create its room; past that the check fails.
# Only a check that could not find the room is dealt again (up to 4 deals); any other stop is the check's result.
# Exit status: the check's own (0 when it passed), 1 when the stack could not be set up.
tag=${1:-table}
file=${2:-tests/live_phasing_check.js}
n=${LIVE_STACK:-0}
if [ "$n" = 0 ]; then sfx=""; else sfx="-$n"; fi
port=$((9444 + n))
relay=mtg-test-relay$sfx
node_c=mtg-test-node$sfx
log=tmp/live-$(basename "$file" .js)-$tag$sfx.log
relay_image=mtg-relay:${LIVE_RELAY:-$tag}
wait_s=${LIVE_ROOM_WAIT:-60}
fail() {
  echo "live-check: $1" >&2
  docker rm -f "$relay" "$node_c" >/dev/null 2>&1
  exit 1
}
docker image inspect "$relay_image" >/dev/null 2>&1 ||
  fail "no relay image $relay_image: build one under the node's tag or set LIVE_RELAY (e.g. LIVE_RELAY=exile)"
docker image inspect "mtg-forge-node:$tag" >/dev/null 2>&1 || fail "no node image mtg-forge-node:$tag"
for try in 1 2 3 4; do
  docker rm -f "$relay" "$node_c" >/dev/null 2>&1
  docker run -d --name "$relay" --network stack_default -p 127.0.0.1:$port:9443 -e MANABREW_SERVER_KEY=tts-local "$relay_image" >/dev/null ||
    fail "the relay $relay_image did not start"
  sleep 2
  docker run -d --name "$node_c" --network stack_default -e SELF_HOSTED_NODE_RELAY_URL=ws://$relay:9443 \
    -e SELF_HOSTED_NODE_SERVER_KEY=tts-local -e SELF_HOSTED_NODE_ROOM_NAME=tts-test -e SELF_HOSTED_NODE_ENGINE_BACKEND=forge \
    -e SELF_HOSTED_NODE_FORMAT=commander -e SELF_HOSTED_NODE_MAX_PLAYERS=4 -e SELF_HOSTED_NODE_AUTO_START=true "mtg-forge-node:$tag" >/dev/null ||
    fail "the node mtg-forge-node:$tag did not start"
  # the node's room appears 10-25 s after start (card index)
  deadline=$(($(date +%s) + wait_s))
  until docker logs "$node_c" 2>&1 | grep -q "room created"; do
    if [ "$(date +%s)" -ge "$deadline" ]; then
      docker logs "$node_c" 2>&1 | tail -20 >&2
      fail "the node's room did not appear within ${wait_s} s (try $try); node log tail above"
    fi
    sleep 1
  done
  sleep 1
  node "$file" --relay "ws://127.0.0.1:$port" --timeout "${LIVE_TIMEOUT:-120}" $LIVE_ARGS > "$log" 2>&1
  status=$?
  grep -qE "^stopped: room .* not found" "$log" || break
done
docker rm -f "$relay" "$node_c" >/dev/null 2>&1
cut -c1-300 "$log"
if [ "$status" != 0 ]; then
  tail -3 "$log" | cut -c1-300 >&2
fi
exit "$status"
