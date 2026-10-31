#!/usr/bin/env bash
# One game with NO test-tool polling: White is played by the in-TTS autopilot (tools/tts-autopilot-long.lua); this
# script only watches the bridge (/state) until the game is over. For checking whether the test tools cause the
# per-game slowdown (problem-log P6). Keyword coverage still counts (the report reads the game log).
#   tools/run-autopilot-game.sh <deck.json> [maxSeconds=900]
cd "$(dirname "$0")/.."
DECK=$1; MAX=${2:-900}; N=$(basename "$DECK" .json)
X="timeout 30 tools/tts-exec.sh"
mine=$(echo 'local d = getDeckFromZone(data.White.libraryZone) if d and d.getGMNotes() ~= "testcard" and not tostring(d.getGMNotes()):find("^engine:") then return "deck " .. d.getName() end return "clear"' | $X | grep -o '"value":"[^"]*"')
[ "$mine" != '"value":"clear"' ] && { echo "STOP: White's zone holds the player's things ($mine)"; exit 1; }
echo 'return tostring(engineChat("mtg reset", Player.White))' | $X >/dev/null; sleep 22
$X tools/tts-cleanup-test.lua >/dev/null
node tools/make-test-deck-lua.js "$DECK" "tmp/spawn-ap-$N.lua" >/dev/null || { echo "$N: could not build"; exit 1; }
sp=$($X "tmp/spawn-ap-$N.lua"); echo "$sp" | grep -q STOP && { echo "$sp"; exit 1; }
for i in $(seq 1 20); do sleep 2; v=$(echo 'local d = getDeckFromZone(data.White.libraryZone) return (d and d.getQuantity() or 0) .. "/" .. #(Player.White.getHandObjects() or {})' | $X); echo "$v" | grep -q '"[1-9][0-9]*/7"' && break; done
echo 'return tostring(engineChat("mtg start ai 1", Player.White))' | $X >/dev/null; sleep 14
echo "autopilotSecs = $MAX return 'x'" | $X >/dev/null
$X tools/tts-autopilot-long.lua >/dev/null
t0=$(date +%s)
mark=$(curl -s -m 5 http://127.0.0.1:48787/log | tail -1)
# the game is over when the table announces it (only lines after this game started count)
while [ $(( $(date +%s) - t0 )) -lt "$MAX" ]; do
  sleep 10
  curl -s -m 5 http://127.0.0.1:48787/log | awk -v m="$mark" 'f{print} $0==m{f=1}' | grep -q "GAME OVER" && break
done
# out of time or over: end the game so the next test starts from an idle table
echo 'autopilotStart = 0 return "stop"' | $X >/dev/null
echo 'return tostring(engineChat("mtg reset", Player.White))' | $X >/dev/null; sleep 20
$X tools/tts-cleanup-test.lua >/dev/null
echo "autopilot $N: game ran $(( $(date +%s) - t0 )) s"
