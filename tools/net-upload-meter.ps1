# Measures this PC's upload while an online TTS game runs (run it on the HOST during a game with friends).
# Samples every network adapter's bytes sent once a second and prints average, 95th percentile and peak in Mbps.
# Usage: powershell -File tools\net-upload-meter.ps1 [-Minutes 20] [-Out tmp\net-upload.csv]
param([int]$Minutes = 20, [string]$Out = "$PSScriptRoot\..\tmp\net-upload.csv")
$samples = New-Object System.Collections.Generic.List[double]
"time,mbps" | Out-File -Encoding utf8 $Out
$end = (Get-Date).AddMinutes($Minutes)
Write-Host "Measuring upload for $Minutes min. Play normally; close other uploads (streams, cloud sync)."
while ((Get-Date) -lt $end) {
  $v = (Get-Counter '\Network Interface(*)\Bytes Sent/sec').CounterSamples | Measure-Object -Property CookedValue -Sum
  $mbps = [math]::Round($v.Sum * 8 / 1e6, 3)
  $samples.Add($mbps)
  "$(Get-Date -Format HH:mm:ss),$mbps" | Out-File -Append -Encoding utf8 $Out
}
$sorted = $samples | Sort-Object
$avg = ($samples | Measure-Object -Average).Average
$p95 = $sorted[[math]::Floor($sorted.Count * 0.95)]
Write-Host ("Upload over {0} s: average {1:N2} Mbps, 95% of seconds under {2:N2} Mbps, peak {3:N2} Mbps" -f $samples.Count, $avg, $p95, $sorted[-1])
Write-Host "Saved every second to $Out"
