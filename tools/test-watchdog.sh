#!/usr/bin/env bash
# Exits (so Claude is notified) when the test run finishes (a new marker line in tmp/health.log) or stalls: no White question
# answered in STALL seconds. Also checks the TTS process is alive.  tools/test-watchdog.sh <marker> [STALL=240]
cd "$(dirname "$0")/.."
MARK=$1; STALL=${2:-240}; marks=$(grep -c -- "$MARK" tmp/health.log); last=$(grep -a -c "prompt White" tmp/bridge-live.log); since=$(date +%s)
while true; do
  sleep 20
  [ "$(grep -c -- "$MARK" tmp/health.log)" -gt "$marks" ] && { echo "DONE: $MARK"; tail -12 tmp/health.log; exit 0; } # a NEW marker line
  tasklist | grep -qi "Tabletop Simulator" || { echo "ALERT: TTS is not running"; exit 2; }
  now=$(grep -a -c "prompt White" tmp/bridge-live.log)
  if [ "$now" -gt "$last" ]; then last=$now; since=$(date +%s)
  elif [ $(( $(date +%s) - since )) -gt "$STALL" ]; then echo "ALERT: no question answered for ${STALL}s"; tail -4 tmp/bridge-live.log; exit 3; fi
done
