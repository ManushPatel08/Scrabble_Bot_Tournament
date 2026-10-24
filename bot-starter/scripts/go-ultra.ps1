# One command for the final switch: ship the chosen strategy into the
# defaults, stop the current bot at a match boundary, re-register it as
# LetterSharkUltra (new team) through the normal account flow, and start it.
#
#   powershell -ExecutionPolicy Bypass -File scripts\go-ultra.ps1               # strategy in scripts\ultra-params.json
#   powershell -ExecutionPolicy Bypass -File scripts\go-ultra.ps1 -NoThreshold  # ship only futureCountNoise 1
#   powershell -ExecutionPolicy Bypass -File scripts\go-ultra.ps1 -Tournament   # start in tournament mode (-NoLobby)
#
# No token is read, written or shown here; run.ps1 mints it in memory.
param(
  [switch]$NoThreshold,
  [switch]$Tournament,
  [string]$Team = 'Manush5',
  [string]$Bot = 'LetterSharkUltra'
)
$ErrorActionPreference = 'Stop'
$botRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location -LiteralPath $botRoot
$stateFile = Join-Path $botRoot 'logs\runner-state.json'
$runner = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
if ($runner.botName -eq $Bot) { throw "Already running as $Bot (bot $($runner.botId)); nothing to do." }

Write-Output '1/5 Shipping the strategy into the defaults'
$paramsFile = 'scripts\ultra-params.json'
if ($NoThreshold) {
  $paramsFile = Join-Path $env:TEMP 'ultra-params-nothreshold.json'
  '{ "futureCountNoise": 1, "cashThreshA": 0, "cashThreshB": 0 }' | Set-Content -LiteralPath $paramsFile -Encoding ascii
}
node scripts/ship-params.mjs --file $paramsFile
if ($LASTEXITCODE -ne 0) { throw 'ship-params failed; nothing else changed.' }
npx tsc -p tsconfig.check.json
if ($LASTEXITCODE -ne 0) { throw 'Typecheck failed after shipping; the old bot is still running. Revert with: git checkout -- src/strategy/params.ts src/strategy/versions.ts' }

Write-Output "2/5 Stopping $($runner.botName) (bot $($runner.botId)) at a match boundary"
& (Join-Path $PSScriptRoot 'restart-live.ps1') -StopOnly

Write-Output "3/5 Re-registering as $Team / $Bot"
npx tsx scripts/replace-registration.ts --from-id $runner.botId --team $Team --bot $Bot
if ($LASTEXITCODE -ne 0) {
  Write-Warning 'Registration change failed; restarting the old bot so nothing stays down.'
  & (Join-Path $PSScriptRoot 'restart-live.ps1')
  throw 'Re-registration failed (old bot restarted on the new defaults).'
}
$new = Get-Content -LiteralPath (Join-Path $botRoot 'logs\new-registration.json') -Raw | ConvertFrom-Json
if ($new.botName -ne $Bot) { throw "Unexpected registration: $($new.botName)" }

Write-Output "4/5 Pointing the runner at bot $($new.botId) / team $($new.teamId)"
$runner.botId = $new.botId
$runner.teamId = $new.teamId
$runner.botName = $new.botName
$runner.teamName = $new.teamName
$runner.logFile = 'logs\ultra-live.log'
$runner.paramsA = $null
$runner.paramsB = $null
if ($runner.PSObject.Properties.Name -contains 'trialSince') { $runner.trialSince = $null }
$runner | ConvertTo-Json | Set-Content -LiteralPath $stateFile

Write-Output '5/5 Starting the new bot on the shipped defaults'
if ($Tournament) { & (Join-Path $PSScriptRoot 'restart-live.ps1') -Tournament }
else { & (Join-Path $PSScriptRoot 'restart-live.ps1') }
Write-Output "Done. Check it with: node scripts\health.mjs"
