#!/usr/bin/env bash
# CPU-contention test: is TTS's stutter caused by Forge's AI using the CPU?
#   1. 120 s with Forge idle: TTS frame counter only (baseline)
#   2. a Forge game (White played by the bridge itself + 2 AIs) while TTS gets no messages at all
# TTS's frame counter (tools/tts-frame-counter.lua) runs throughout; Docker CPU is sampled every 3 s.
cd "$(dirname "$0")/.."
X="timeout 30 tools/tts-exec.sh"
$X tools/tts-frame-counter.lua
t0=$(date +%s)
sample() { echo "$(( $(date +%s) - t0 )) $(docker stats --no-stream --format '{{.Name}} {{.CPUPerc}}' 2>/dev/null | grep forge-room | awk '{print $2}')"; }
while [ $(( $(date +%s) - t0 )) -lt 110 ]; do sample; sleep 3; done > tmp/cpu-test.txt
echo "--- game starts ---" >> tmp/cpu-test.txt
curl -s -X POST -H "Content-Type: application/json" -d '{"t":"start","json":"{\"t\":\"start\",\"seats\":[\"White\"],\"bots\":2,\"autoplay\":true}"}' http://127.0.0.1:48787/msg >/dev/null
while [ $(( $(date +%s) - t0 )) -lt 245 ]; do sample; sleep 3; done >> tmp/cpu-test.txt
sleep 3
echo 'return engineFrameReport()' | $X > tmp/cpu-test-frames.json
curl -s -X POST -H "Content-Type: application/json" -d '{"t":"reset","json":"{\"t\":\"reset\"}"}' http://127.0.0.1:48787/msg >/dev/null
node -e '
  const fs = require("fs");
  const raw = JSON.parse(fs.readFileSync("tmp/cpu-test-frames.json", "utf8")).value.split("|").map((x) => x.split(" ").map(Number));
  const fc = { perSec: [0, ...raw.map((r) => r[0])], slowSec: raw.flatMap((r, i) => Array(r[1]).fill(i)) };
  const lines = fs.readFileSync("tmp/cpu-test.txt", "utf8").trim().split("\n");
  const split = lines.indexOf("--- game starts ---");
  const startSec = Number((lines[split - 1] || "110").split(" ")[0]) + 3; // perSec[s + 1] = frames in second s
  const slowBefore = fc.slowSec.filter((s) => s < startSec).length, slowAfter = fc.slowSec.filter((s) => s >= startSec).length;
  const fps = (a, b) => { let n = 0; for (let s = a; s < b; s++) n += fc.perSec[s + 1] || 0; return (n / (b - a)).toFixed(0); };
  const cpu = (arr) => { const v = arr.map((l) => parseFloat(l.split(" ")[1])).filter((x) => !isNaN(x)); return v.length ? `avg ${(v.reduce((a, b) => a + b, 0) / v.length).toFixed(0)}%, max ${Math.max(...v).toFixed(0)}%` : "-"; };
  console.log(`Forge idle  (0-${startSec}s): ${fps(0, startSec)} fps, ${slowBefore} slow frames, Forge CPU ${cpu(lines.slice(0, split))}`);
  console.log(`Forge game  (${startSec}-240s): ${fps(startSec, 240)} fps, ${slowAfter} slow frames, Forge CPU ${cpu(lines.slice(split + 1))}`);
'
