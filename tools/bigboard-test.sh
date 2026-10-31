#!/usr/bin/env bash
# Big late-game board in the real TTS: Blue (the player's own deck, played by the driver, never attacking) against
# three harmless AIs building big boards (preset ai_bigboard: walls, Wall of Kelp tokens, 20 mana rocks, self-mill).
# Measures frame times with PresentMon for the whole game, samples board sizes and the table's slowest handlers,
# then times "mtg reset" on the full board.
#   tools/bigboard-test.sh [stopGameTurn=100]
# Needs: TTS with the engine table loaded, Blue seated, no game running; the live bridge on 48787.
cd "$(dirname "$0")/.."
STOP=${1:-100}
X="tools/tts-exec.sh"
OUT=tmp/bigboard; mkdir -p $OUT
busy=$(echo 'local t = engineTable() if t ~= nil and not t.gameOver then return "game running" end return "idle"' | $X | grep -o '"value":"[^"]*"')
[ "$busy" = '"value":"idle"' ] || { echo "STOP: a game is running"; exit 1; }
docker compose -f stack/compose.yml restart forge-room >/dev/null 2>&1; sleep 15
for i in 1 2 3; do echo 'return tostring(engineChat("mtg aideck ai_bigboard", Player.Blue))' | $X >/dev/null; done
# the table's profiler from zero
echo 'engineProfile.calls, engineProfile.total, engineProfile.max, engineProfile.slow, engineProfile.hitches, engineProfile.sect = {}, {}, {}, {}, {}, {} return "reset"' | $X >/dev/null
tools/presentmon/PresentMon.exe --process_name "Tabletop Simulator.exe" --output_file "$OUT/frames.csv" --timed 5400 --terminate_after_timed --no_console_stats >/dev/null 2>&1 &
PM=$!
echo 'return tostring(engineChat("mtg start ai 3 builtin", Player.Blue))' | $X >/dev/null
sleep 20
# QUIET=1: Blue only passes, answered through the bridge (tools/pass-driver.js), and nothing runs Lua in TTS during
# the game: the frame times are then the table's own (each test-tool command costs TTS ~360 ms)
if [ -n "$QUIET" ]; then timeout 5000 node tools/pass-driver.js Blue "$STOP" > $OUT/autoplay.json 2>&1 &
else AP_COLOR=Blue timeout 5000 node tools/tts-autoplay2.js "$STOP" 4000 > $OUT/autoplay.json 2>&1 & fi
AP=$!
# every 2 minutes: permanents per player, graveyard sizes, slowest handlers so far
while kill -0 $AP 2>/dev/null; do
  sleep 120
  if [ -n "$QUIET" ]; then
    curl -s -m 5 localhost:48787/state | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s); const st=(j.seats||[])[0]; if (!st) return; console.log(`turn ${st.turn} | ` + st.battlefield.map((b) => `${b.owner} bf=${b.cards.length}`).join(", "))})' >> $OUT/samples.txt
    tail -1 $OUT/samples.txt; continue
  fi
  echo 'local t = engineTable() if not t then return "no game" end local o = {} for _, p in ipairs(t.players or {}) do o[#o+1] = tostring(p.color) .. " bf=" .. #(p.battlefield or {}) .. " gy=" .. #(p.graveyard or {}) .. " hand=" .. tostring(p.handCount) end
    local m = {} for k, v in pairs(engineProfile.max) do m[#m+1] = k .. "=" .. string.format("%.0f", v) end
    return "turn " .. tostring(t.turn) .. " | " .. table.concat(o, ", ") .. " | max ms: " .. table.concat(m, " ")' | $X | grep -o '"value":"[^"]*"' >> $OUT/samples.txt
  tail -1 $OUT/samples.txt
done
powershell -File tools/tts-shot.ps1 "$OUT/board.jpg" >/dev/null
echo 'local P = engineProfile local o = {} for k, v in pairs(P.max) do o[#o+1] = k .. " max " .. string.format("%.0f", v) .. "ms avg " .. string.format("%.1f", (P.total[k] or 0) / math.max(1, P.calls[k] or 1)) .. "ms x" .. (P.calls[k] or 0) end local q = {} for k, v in pairs(P.sect or {}) do q[#q+1] = k .. "=" .. string.format("%.0f", v) end return table.concat(o, " | ") .. " || render sections, total ms: " .. table.concat(q, " ") .. " || slow: " .. table.concat(P.slow, "; ")' | $X > $OUT/profile.json
# "mtg reset" on the full board: when it was typed (PresentMon's clock is QPC seconds; the CSV shows the hitch)
date +%s%3N > $OUT/reset.at
echo 'return tostring(engineChat("mtg reset", Player.Blue))' | $X >/dev/null
sleep 30
echo 'local n = 0 for _, o in ipairs(getObjects()) do if tostring(o.getGMNotes()):find("^engine:") then n = n + 1 end end return n' | $X > $OUT/after-reset.json
sleep 20
logman stop PresentMon -ets >/dev/null 2>&1
echo done
