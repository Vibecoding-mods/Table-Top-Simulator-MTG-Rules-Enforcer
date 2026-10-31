#!/bin/bash
# Runs the Commander rules checklist (bridge/rules-check.js) on a freshly restarted Forge room.
#   bash tools/rules-check.sh tax|cmddmg
cd "$(dirname "$0")/.."
docker compose -f stack/compose.yml restart forge-room >/dev/null 2>&1
sleep 20
cd bridge && timeout 1500 node rules-check.js --game "${1:-tax}" > "../tmp/rules-$1.out" 2>&1
tail -12 "../tmp/rules-$1.out"
