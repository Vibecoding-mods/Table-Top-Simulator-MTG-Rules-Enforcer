# Create tonight's Forge droplet from the newest golden snapshot, and wait until the relay answers.
#   powershell -File tools\vps-up.ps1 -SshKey <fingerprint> [-Region nyc3] [-Size c-4]
# docs/server-setup-spec.md steps A-H come first. It bills from now until vps-down.ps1 deletes it.
param(
    [Parameter(Mandatory = $true)][string]$SshKey,
    [string]$Region = "nyc3",
    [string]$Size = "c-4",
    [string]$Name = "manabrew-vps",
    [int]$WaitMinutes = 10
)
$ErrorActionPreference = "Stop"

$existing = doctl compute droplet list --format Name --no-header | Where-Object { $_.Trim() -eq $Name }
if ($existing) { throw "$Name already exists. Check it, or delete it with vps-down.ps1." }

# (the newest by its creation time, not the last line of a list whose order doctl doesn't promise: an old golden
# snapshot has old images and would be booted and billed for the night. The CreatedAt column is ISO, so it sorts as text.)
$snap = doctl compute snapshot list --resource droplet --format ID,Name,CreatedAt --no-header |
    Where-Object { $_ -match "manabrew-golden" } |
    Sort-Object { ($_.Trim() -split '\s+')[-1] } | Select-Object -Last 1
if (-not $snap) { throw "No manabrew-golden snapshot: finish step H of the server spec first." }
$id = ($snap.Trim() -split '\s+')[0]
Write-Host "Booting snapshot $($snap.Trim())"

doctl compute droplet create $Name --image $id --size $Size --region $Region --tag-names manabrew --ssh-keys $SshKey --wait

$deadline = (Get-Date).AddMinutes($WaitMinutes)
while (-not (Test-NetConnection $Name -Port 9443 -WarningAction SilentlyContinue).TcpTestSucceeded) {
    if ((Get-Date) -gt $deadline) { throw "The relay didn't answer in $WaitMinutes minutes. The droplet is still billing: run vps-down.ps1." }
    Start-Sleep -Seconds 10
}
Write-Host "Forge relay is up on ${Name}:9443."
