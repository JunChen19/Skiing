[CmdletBinding()]
param(
    [switch]$AtBoot,
    [string]$RunAsUser = [Security.Principal.WindowsIdentity]::GetCurrent().Name,
    [string]$DataDir = (Join-Path $env:LOCALAPPDATA 'SnowlineLeaderboard'),
    [ValidateRange(1024, 65535)]
    [int]$Port = 8715
)

$ErrorActionPreference = 'Stop'
$taskName = 'Snowline Leaderboard'
$root = Split-Path -Parent $PSScriptRoot
$server = Join-Path $root 'server\leaderboard.js'
$node = (Get-Command node.exe -CommandType Application | Select-Object -First 1).Source
& $node -e "require('node:sqlite')" 2>$null
if ($LASTEXITCODE -ne 0) { throw 'Node.js with node:sqlite is required.' }
$dataPath = [IO.Path]::GetFullPath($DataDir)
if ($dataPath.EndsWith('\')) { $dataPath += '.' }

if ($AtBoot) {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    if (!$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Run from an administrator PowerShell to register a boot trigger. Omit -AtBoot to register at sign-in.'
    }
    $trigger = New-ScheduledTaskTrigger -AtStartup
    $logon = 'S4U'
} else {
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $RunAsUser
    $logon = 'Interactive'
}

New-Item -ItemType Directory -Path $dataPath -Force | Out-Null
$arguments = '"{0}" --port {1} --data-dir "{2}"' -f $server, $Port, $dataPath
$action = New-ScheduledTaskAction -Execute $node -WorkingDirectory $root -Argument $arguments
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
$taskPrincipal = New-ScheduledTaskPrincipal -UserId $RunAsUser -LogonType $logon -RunLevel Limited
if ((Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue).State -eq 'Running') {
    Stop-ScheduledTask -TaskName $taskName
}
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings `
    -Principal $taskPrincipal -Description 'Runs the local Snowline leaderboard and SQLite storage.' -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Host "Registered $taskName ($logon). Open http://127.0.0.1:$Port/"
