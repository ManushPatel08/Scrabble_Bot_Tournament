# Restarts the one launcher recorded in logs/runner-state.json, at a match
# boundary. No token is read by this helper, written to disk, or displayed.
param(
  [switch]$Tournament,
  [string]$ParamsB,
  [switch]$IfDown
)
$ErrorActionPreference = 'Stop'
$botRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location -LiteralPath $botRoot
$stateFile = Join-Path $botRoot 'logs\runner-state.json'
if (-not (Test-Path -LiteralPath $stateFile)) { throw 'Missing runner state; inspect processes before starting anything.' }
$runner = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
if ($ParamsB -and -not $Tournament) {
  $candidate = $ParamsB | ConvertFrom-Json
  if (-not $candidate -or $ParamsB -match 'BOT_TOKEN|eyJ') { throw 'Invalid strategy overrides.' }
}
$launcher = Get-Process -Id $runner.launcherPid -ErrorAction SilentlyContinue
$snapshot = @(Get-CimInstance Win32_Process)
if ($launcher) {
  $rootInfo = $snapshot | Where-Object ProcessId -eq $runner.launcherPid
  # PowerShell 7 converts ISO JSON timestamps to DateTime; 5.1 leaves strings.
  $expectedStart = ([datetime]$runner.processStartUtc).ToUniversalTime()
  if ($launcher.StartTime.ToUniversalTime() -ne $expectedStart -or
      $rootInfo.CommandLine -notmatch 'run\.ps1' -or $rootInfo.CommandLine -notmatch 'LetterSharkPro') {
    throw 'Recorded PID no longer identifies this launcher; no processes stopped.'
  }
  if ($IfDown) { Write-Output 'Launcher is already running; no duplicate started.'; exit 0 }
  $log = Join-Path $botRoot $runner.logFile
  $finished = $false
  $boundaryDeadline = (Get-Date).AddSeconds(100)
  while ((Get-Date) -lt $boundaryDeadline) {
    $tail = if (Test-Path -LiteralPath $log) { Get-Content -LiteralPath $log -Tail 220 } else { @() }
    $start = @($tail | Select-String 'match (\d+): seat' | Select-Object -Last 1)
    $end = @($tail | Select-String 'match (\d+) ended:' | Select-Object -Last 1)
    if (($start.Count -eq 0 -and $end.Count -gt 0) -or
        ($start.Count -gt 0 -and $end.Count -gt 0 -and $end[0].Matches[0].Groups[1].Value -eq $start[0].Matches[0].Groups[1].Value)) {
      $finished = $true; break
    }
    Start-Sleep -Milliseconds 200
  }
  if (-not $finished) { throw 'No safe match boundary within 100 seconds; running bot left alone.' }
}
# Refresh after waiting: the supervisor may have restarted a child meanwhile.
$snapshot = @(Get-CimInstance Win32_Process)
# Derive only descendants of the verified launcher, never unrelated node jobs.
$owned = [Collections.Generic.HashSet[int]]::new()
[void]$owned.Add([int]$runner.launcherPid)
do {
  $before = $owned.Count
  foreach ($proc in $snapshot) { if ($owned.Contains([int]$proc.ParentProcessId)) { [void]$owned.Add([int]$proc.ProcessId) } }
} while ($owned.Count -gt $before)
# If the launcher is gone but its recorded child still lives, refuse to duplicate it.
if (-not $launcher) {
  $strays = @($snapshot | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like "*$botRoot*" -and $_.CommandLine -match 'src[/\\]index\.ts' })
  if ($strays.Count) { throw 'A bot child still exists without the launcher; inspect it before restarting.' }
} else {
  Stop-Process -Id $runner.launcherPid
  foreach ($pidToStop in $owned) {
    if ($pidToStop -ne $runner.launcherPid) { Stop-Process -Id $pidToStop -ErrorAction SilentlyContinue }
  }
}
Remove-Item Env:BOT_PARAMS,Env:BOT_PARAMS_B,Env:BOT_TOKEN,Env:AUTO_LOBBY,Env:AUTO_TOURNAMENT -ErrorAction SilentlyContinue
if ($ParamsB -and -not $Tournament) {
  $env:BOT_PARAMS_B = $ParamsB
}
$logFile = if ($Tournament) { 'logs\tournament.log' } else { 'logs\codex-live.log' }
$launchArgs = @('-NoProfile','-ExecutionPolicy','Bypass','-File','.\run.ps1','-BotName','LetterSharkPro','-Team','Manush','-Bot','LetterSharkPro','-NewToken','-LogFile',$logFile)
if ($Tournament) { $launchArgs += '-NoLobby' }
$next = Start-Process powershell -WindowStyle Hidden -WorkingDirectory $botRoot -ArgumentList $launchArgs -RedirectStandardOutput 'logs\codex-launch.out.log' -RedirectStandardError 'logs\codex-launch.err.log' -PassThru
@{ launcherPid = $next.Id; processStartUtc = $next.StartTime.ToUniversalTime().ToString('o'); botId = 76; teamId = 70; logFile = $logFile; paramsB = $(if ($ParamsB -and -not $Tournament) { $ParamsB } else { $null }); tournamentMode = [bool]$Tournament } |
  ConvertTo-Json | Set-Content -LiteralPath $stateFile
Write-Output "LetterSharkPro launcher PID $($next.Id); log $logFile"
