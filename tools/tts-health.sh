#!/usr/bin/env bash
# One line of TTS health between test games: process memory, object counts by kind, Lua memory, exec round trip.
cd "$(dirname "$0")/.."
cat > tmp/health.lua <<'LUA'
local n, by = 0, {}
for _, o in ipairs(getObjects()) do
  n = n + 1
  local gm = tostring(o.getGMNotes())
  local k = (gm:find("^engine") and "engine") or (gm == "libcard" and "libcard") or (gm == "testcard" and "test") or "table"
  by[k] = (by[k] or 0) + 1
end
local s = {}
for k, v in pairs(by) do s[#s + 1] = k .. "=" .. v end
table.sort(s)
return "objects " .. n .. " (" .. table.concat(s, " ") .. ")"
LUA
t0=$(date +%s%3N)
r=$(timeout 60 tools/tts-exec.sh tmp/health.lua | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{console.log(JSON.parse(s).value||s)}catch{console.log(s)}})")
t1=$(date +%s%3N)
mem=$(tasklist //FI "IMAGENAME eq Tabletop Simulator.exe" //FO CSV //NH | awk -F'","' '{gsub(/[^0-9]/,"",$5); print int($5/1024)}')
echo "$(date +%H:%M) tts ${mem} MB | $r | exec $((t1-t0)) ms"
