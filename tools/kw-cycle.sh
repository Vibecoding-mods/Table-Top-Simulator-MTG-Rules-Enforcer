#!/usr/bin/env bash
# One test cycle: reload the table (clears the per-game slowdown the test tools build up, problem-log P6), then play
# the next 7 keyword decks with the test tools. Ends so whoever started it (Claude) is notified and starts the next.
#   tools/kw-cycle.sh [N=7]
cd "$(dirname "$0")/.."
SAVE="$USERPROFILE/Documents/My Games/Tabletop Simulator/Saves/MTG 4 player table - ENGINE MODE + your decks.json"
echo 'return tostring(engineChat("mtg reset", Player.White))' | timeout 30 tools/tts-exec.sh >/dev/null; sleep 20
timeout 30 tools/tts-exec.sh tools/tts-cleanup-test.lua >/dev/null
timeout 90 node tools/tts-push-global.js "$SAVE" --force >/dev/null 2>&1; sleep 45
echo "== cycle: reloaded" >> tmp/health.log; echo "$(tools/tts-health.sh) [after reload]" >> tmp/health.log
# faster coverage (user's idea): the AI plays a harmless deck (a defender commander + 99 lands), White gets 20
# keyword cards per deck and games run to turn 50, so most of each deck gets drawn and cast
echo 'return tostring(engineChat("mtg aideck clear", Player.White)) .. tostring(engineChat("mtg aideck ai_passive_lands", Player.White))' | timeout 30 tools/tts-exec.sh >/dev/null
export AI_START="mtg start ai 1 builtin" KW_STOP=${KW_STOP:-50} KW_PER=${KW_PER:-20}
tools/kw-batch.sh "${1:-7}" driver
echo "== cycle done" >> tmp/health.log
