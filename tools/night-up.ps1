# Full hosting, start of game night: the Windows TTS host and the Forge droplet together.
#   powershell -File tools\night-up.ps1 -InstanceId i-xxxxxxxx -SshKey <fingerprint> [-AwsProfile ttsnight]
# Then connect with DCV, load Mock MTGA 4 player, Host, invite friends, and disconnect DCV.
param(
    [Parameter(Mandatory = $true)][string]$InstanceId,
    [Parameter(Mandatory = $true)][string]$SshKey,
    [string]$AwsProfile = "ttsnight"
)
$ErrorActionPreference = "Stop"

aws ec2 start-instances --instance-ids $InstanceId --profile $AwsProfile | Out-Null
try {
    & "$PSScriptRoot\vps-up.ps1" -SshKey $SshKey
} catch {
    aws ec2 stop-instances --instance-ids $InstanceId --profile $AwsProfile | Out-Null
    throw
}
aws ec2 wait instance-running --instance-ids $InstanceId --profile $AwsProfile
Write-Host "Windows host and Forge are up, and both are billing until night-down.ps1."
