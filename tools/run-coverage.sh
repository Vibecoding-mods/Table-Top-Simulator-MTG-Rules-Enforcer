#!/usr/bin/env bash
# Representative-card games: plays each coverage deck (tools/make-coverage-decks.js) as White against one Forge AI
# with the bug-hunting autoplay, then records what happened: every kind of engine prompt seen, unsupported prompts,
# engine errors and aborts, TTS errors and table/engine mismatches.
#   tools/run-coverage.sh [stopTurn=16] [deck files...]   (default: every tmp/coverage/deck-*.json)
# Results: tmp/coverage/result-NN.json and a line per deck in tmp/coverage/summary.txt.
# Only ever touches White's seat and objects marked "testcard"; refuses to run if White's zones hold anything else.
cd "$(dirname "$0")/.."
X="timeout 30 tools/tts-exec.sh"
XS="timeout 90 tools/tts-exec.sh" # (the safety checks: a busy headless table can take a while to answer)
STOP=${1:-16}; shift || true
DECKS=("$@"); [ ${#DECKS[@]} -eq 0 ] && DECKS=(tmp/coverage/deck-*.json)
LOG=${BRIDGE_LOG:-tmp/bridge-live.log}  # BRIDGE_PORT=48788 BRIDGE_LOG=tmp/bridge2.log: the headless TTS (tests/lua/headless-tts.js)

for DECK in "${DECKS[@]}"; do
  N=$(basename "$DECK" .json | sed 's/deck-//')
  # safety: never mix a test deck into a player's own cards
  mine=""; for try in 1 2 3 4 5; do [ -n "$mine" ] && break; mine=$(echo 'local d = getDeckFromZone(data.White.libraryZone) if d and d.getGMNotes() ~= "testcard" and not tostring(d.getGMNotes()):find("^engine:") then return "deck " .. d.getName() end for _, o in ipairs(Player.White.getHandObjects() or {}) do if o.getGMNotes() ~= "testcard" and not tostring(o.getGMNotes()):find("^engine:") then return "hand card " .. o.getName() end end return "clear"' | $XS | grep -o '"value":"[^"]*"'); done  # (a busy table can time out once)
  if [ "$mine" != '"value":"clear"' ]; then echo "STOP: White's zones hold the player's own things ($mine)"; exit 1; fi
  # a game the player is in (their deck waits under the table, so the zone above looks empty)
  if [ "$N" = "$(basename "${DECKS[0]}" .json | sed 's/deck-//')" ]; then
    busy=$(echo 'local t = engineTable() if t ~= nil and not t.gameOver then return "game running" end return "idle"' | $X | grep -o '"value":"[^"]*"')
    if [ "$busy" != '"value":"idle"' ]; then echo "STOP: a game is running on the table; not resetting it"; exit 1; fi
  fi

  echo 'return tostring(engineChat("mtg reset", Player.White))' | $X >/dev/null; sleep 22
  $X tools/tts-cleanup-test.lua >/dev/null
  # check again: the reset puts decks the engine had set aside back where they were (2026-10-19 a test deck merged
  # into the player's deck because it came back into White's library zone after the first check)
  mine=""; for try in 1 2 3 4 5; do [ -n "$mine" ] && break; mine=$(echo 'local d = getDeckFromZone(data.White.libraryZone) if d and d.getGMNotes() ~= "testcard" and not tostring(d.getGMNotes()):find("^engine:") then return "deck " .. d.getName() end for _, o in ipairs(Player.White.getHandObjects() or {}) do if o.getGMNotes() ~= "testcard" and not tostring(o.getGMNotes()):find("^engine:") then return "hand card " .. o.getName() end end return "clear"' | $XS | grep -o '"value":"[^"]*"'); done  # (a busy table can time out once)
  if [ "$mine" != '"value":"clear"' ]; then echo "STOP: after the reset, White's zones hold the player's own things ($mine)"; exit 1; fi
  node tools/make-test-deck-lua.js "$DECK" "tmp/spawn-cov-$N.lua" >/dev/null || { echo "deck $N: could not build"; continue; }
  sp=$($X "tmp/spawn-cov-$N.lua"); echo "$sp" | grep -q STOP && { echo "$sp"; exit 1; }
  for i in $(seq 1 20); do sleep 2; v=$(echo 'local d = getDeckFromZone(data.White.libraryZone) return (d and d.getQuantity() or 0) .. "/" .. #(Player.White.getHandObjects() or {})' | $X); echo "$v" | grep -q '"[1-9][0-9]*/7"' && break; done
  mark=$(wc -l < "$LOG")
  cmark=$(curl -s http://127.0.0.1:${BRIDGE_PORT:-48787}/log | tail -1)
  start=$(echo "return tostring(engineChat(\"${AI_START:-mtg start ai 1}\", Player.White))" | $X)
  sleep 14
  # the deck's keyword cards: the driver picks them first when a tutor searches
  KW=$(node -e 'try { console.log(Object.keys(require("./" + process.argv[1]).keywords || {}).join("|")) } catch { console.log("") }' "$DECK")
  KW_CARDS="$KW" timeout 2400 node "${AUTOPLAY:-tools/tts-autoplay2.js}" "$STOP" 1800 > "tmp/coverage/autoplay-$N.json" 2>&1
  tail -n +"$mark" "$LOG" > "tmp/coverage/bridge-$N.log"
  # only this game's console lines (the bridge keeps everything since it started)
  # (the bridge keeps the last 500 lines; if the start line rolled out, keep them all)
  # (after the LAST line equal to the marker: the marker is often a repeated line, and the first match started inside the previous game's lines)
  curl -s http://127.0.0.1:${BRIDGE_PORT:-48787}/log | awk -v m="$cmark" '{a[NR]=$0; if ($0==m) last=NR} END{for (i=last+1; i<=NR; i++) print a[i]}' | grep -v "print: nil" > "tmp/coverage/console-$N.log"
  [ -s "tmp/coverage/console-$N.log" ] || curl -s http://127.0.0.1:${BRIDGE_PORT:-48787}/log | grep -v "print: nil" > "tmp/coverage/console-$N.log"
  node -e '
    const fs = require("fs"); const n = process.argv[1];
    const blog = fs.readFileSync(`tmp/coverage/bridge-${n}.log`, "utf8");
    const con = fs.readFileSync(`tmp/coverage/console-${n}.log`, "utf8");
    let ap = {}; try { ap = JSON.parse(fs.readFileSync(`tmp/coverage/autoplay-${n}.json`, "utf8").replace(/^[^{]*/, "")); } catch {}
    const types = {};
    for (const m of blog.matchAll(/prompt White #\d+: (\w+)/g)) types[m[1]] = (types[m[1]] || 0) + 1;
    const pick = (re) => [...new Set([...blog.matchAll(re), ...con.matchAll(re)].map((m) => m[0].slice(0, 200)))];
    const out = {
      deck: n, promptTypes: types,
      unsupported: pick(/Unsupported prompt[^\n]*|unhandled prompt[^\n]*/g),
      engineErrors: pick(/Engine error[^\n]*|\bfatal (error|exception)[^\n]*|Exception[^\n]*/gi), // not "Fatal Push"
      aborted: /Game aborted/.test(con) && !/Game over/.test(con),
      ttsErrors: pick(/ERROR[^\n]*/g).filter((e) => !/executeScript/.test(e)),
      tableProblems: (ap.problems || []).slice(0, 20), stuck: ap.stuck || [], lastTurn: ap.lastTurn, steps: ap.steps,
    };
    fs.writeFileSync(`tmp/coverage/result-${n}.json`, JSON.stringify(out, null, 1));
    const line = `deck ${n}: turn ${out.lastTurn}, ${out.steps} steps, prompts ${Object.keys(types).length} kinds, unsupported ${out.unsupported.length}, engine errors ${out.engineErrors.length}, TTS errors ${out.ttsErrors.length}, table problems ${out.tableProblems.length}${out.aborted ? ", ABORTED" : ""}`;
    fs.appendFileSync("tmp/coverage/summary.txt", line + "\n"); console.log(line);
  ' "$N"
done
echo 'return tostring(engineChat("mtg reset", Player.White))' | $X >/dev/null; sleep 8
$X tools/tts-cleanup-test.lua >/dev/null
