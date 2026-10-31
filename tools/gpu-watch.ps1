# Logs GPU memory, load and TTS's size every 15 s to tmp/gpu-watch.csv, so the next driver reset shows what led up to it.
# Start: Start-Process powershell -WindowStyle Hidden -ArgumentList '-NoProfile','-File','tools\gpu-watch.ps1'
$out = Join-Path $PSScriptRoot "..\tmp\gpu-watch.csv"
$log = Join-Path $env:USERPROFILE "AppData\LocalLow\Berserk Games\Tabletop Simulator\Player.log"
if (-not (Test-Path $out)) { "time,vram_used_mb,vram_total_mb,gpu_util,temp_c,clock_mhz,pstate,tts_mb,tts_objects" | Out-File $out -Encoding utf8 }
while ($true) {
  $g = (& "C:\Windows\System32\nvidia-smi.exe" --query-gpu=memory.used,memory.total,utilization.gpu,temperature.gpu,clocks.gr,pstate --format=csv,noheader,nounits) -replace '\s', ''
  $p = Get-Process "Tabletop Simulator" -ErrorAction SilentlyContinue | Select-Object -First 1
  $mb = if ($p) { [int]($p.WorkingSet64 / 1MB) } else { "" }
  $objs = ""
  try { $m = Select-String -Path $log -Pattern "Loaded Objects now: (\d+)" | Select-Object -Last 1; if ($m) { $objs = $m.Matches[0].Groups[1].Value } } catch {}
  "$((Get-Date).ToString('yyyy-MM-dd HH:mm:ss')),$g,$mb,$objs" | Out-File $out -Append -Encoding utf8
  Start-Sleep -Seconds 15
}
