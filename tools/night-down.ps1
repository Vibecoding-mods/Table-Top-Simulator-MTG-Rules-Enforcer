# Full hosting, end of game night: stop the Windows TTS host and delete the Forge droplet, then check both.
#   powershell -File tools\night-down.ps1 -InstanceId i-xxxxxxxx [-AwsProfile ttsnight]
param(
    [Parameter(Mandatory = $true)][string]$InstanceId,
    [string]$AwsProfile = "ttsnight"
)
$ErrorActionPreference = "Stop"

aws ec2 stop-instances --instance-ids $InstanceId --profile $AwsProfile | Out-Null
& "$PSScriptRoot\vps-down.ps1"
aws ec2 wait instance-stopped --instance-ids $InstanceId --profile $AwsProfile
Write-Host "Windows host stopped. Its disk still bills a little each month; compute doesn't."
