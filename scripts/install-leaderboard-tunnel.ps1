[CmdletBinding()]
param(
    [string]$NgrokPath = (Join-Path $env:LOCALAPPDATA 'SnowlineLeaderboard\tools\ngrok.exe'),
    [ValidateRange(1024, 65535)]
    [int]$Port = 8715
)

$ErrorActionPreference = 'Stop'
$taskName = 'Snowline Leaderboard Tunnel'
$ngrok = (Get-Command $NgrokPath -CommandType Application | Select-Object -First 1).Source
& $ngrok config check
if ($LASTEXITCODE -ne 0) { throw 'Configure ngrok with the authtoken from your dashboard first.' }

$policy = Join-Path $PSScriptRoot 'leaderboard-tunnel.yml'
$log = Join-Path $env:LOCALAPPDATA 'SnowlineLeaderboard\tunnel.log'
$arguments = 'http http://127.0.0.1:{0} --inspect=false --traffic-policy-file "{1}" --log "{2}"' -f $Port, $policy, $log
$action = New-ScheduledTaskAction -Execute $ngrok -WorkingDirectory $PSScriptRoot -Argument $arguments
$user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
if ((Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue).State -eq 'Running') {
    Stop-ScheduledTask -TaskName $taskName
}
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings `
    -Principal $principal -Description 'Exposes the Snowline score API through the account ngrok dev domain.' -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Host "Started $taskName. Check the agent status at http://127.0.0.1:4040."
