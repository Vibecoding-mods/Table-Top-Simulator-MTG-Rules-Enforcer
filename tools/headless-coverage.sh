#!/usr/bin/env bash
# Plays coverage/keyword decks with no TTS window: starts the headless TTS (tests/lua/headless-tts.js, the table's
# Global script built from the current sources) and a second bridge on other ports, runs tools/run-coverage.sh
# against them, then stops both. The AI plays Errant, Street Artist (defender) and 99 Islands: it never attacks.
# Uses the Forge room, so not while a real game is being played.
#   tools/headless-coverage.sh [stopTurn=25] [deck files...]
cd "$(dirname "$0")/.."
STOP=${1:-25}; shift || true
node -e 'const {buildSave}=require("./tests/golden/table-run"); require("fs").writeFileSync("tmp/table-build/headless.json", JSON.stringify(buildSave()))' || exit 1
# (a game saved for crash recovery by an earlier batch would be rejoined: start clean)
rm -f tmp/bridge-game-headless.json
node tests/lua/headless-tts.js --save tmp/table-build/headless.json --seated White > tmp/headless.log 2>&1 &
HEADLESS=$!
(cd bridge && MTG_TRACE=1 MTG_RAW=${MTG_RAW:-} MTG_RESUME_FILE="$PWD/../tmp/bridge-game-headless.json" MTG_RECORD="$PWD/../tmp/tts-stream-headless.jsonl" exec node bridge.js --tts-in 39988 --tts-out 39989 --debug-port 48788) > tmp/bridge2.log 2>&1 &
BRIDGE=$!
trap 'kill $HEADLESS $BRIDGE 2>/dev/null' EXIT
for i in $(seq 1 30); do curl -s -m 2 localhost:48788/stats >/dev/null 2>&1 && break; sleep 1; done
sleep 3
BRIDGE_PORT=48788 tools/tts-exec.sh <<< 'return tostring(engineChat("mtg aideck '"${AI_DECK:-ai_passive_errant}"'", Player.White))' >/dev/null
BRIDGE_PORT=48788 BRIDGE_LOG=tmp/bridge2.log AI_START="mtg start ai 1 builtin" bash tools/run-coverage.sh "$STOP" "$@"
