# Delete tonight's Forge droplet. The golden snapshot stays. A powered-off droplet still bills, so this has to delete it.
param([string]$Name = "manabrew-vps")
$ErrorActionPreference = "Stop"

$existing = doctl compute droplet list --format Name --no-header | Where-Object { $_.Trim() -eq $Name }
if ($existing) { doctl compute droplet delete $Name --force }

$left = doctl compute droplet list --format Name --no-header | Where-Object { $_.Trim() -eq $Name }
if ($left) { throw "$Name is still there and still billing: delete it in the DigitalOcean dashboard." }
Write-Host "No $Name droplet left."
