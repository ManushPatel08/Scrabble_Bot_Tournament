# Launches the ScrabbleBot bot and keeps it running (Windows PowerShell 5.1+).
#
#   powershell -ExecutionPolicy Bypass -File .\run.ps1 -BotName <your bot name>
#
# - Asks for the bot token with hidden input. The token is held only in this
#   process's environment: it is never written to disk, never echoed, and
#   never lands in your PowerShell history. (If BOT_TOKEN is already set in
#   the environment, that is used instead.)
# - Keeps Windows awake while the bot runs, so the machine can't sleep in the
#   middle of a tournament.
# - Restarts the bot if it ever crashes. It stops on configuration errors
#   (exit code 2: missing or invalid token) and on Ctrl+C.
# - The bot itself reconnects after network drops, rejoins a match in
#   progress, and registers for any tournament that opens.

param(
  [Parameter(Mandatory = $true)][string]$BotName,
  [switch]$NoLobby,         # don't join casual lobbies (tournaments still on)
  [switch]$NoTournament,    # don't register for tournaments
  [switch]$Quiet,           # one log line per match instead of per auction
  [switch]$FromClipboard,   # take the token from the clipboard (npm run get-token) and clear it
  [string]$LogFile          # also append timestamped log lines to this file (never the token)
)

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

if ($FromClipboard) {
  # Straight from the clipboard into this process's environment: never shown.
  $clip = Get-Clipboard -Raw
  if ($clip) { $env:BOT_TOKEN = $clip.Trim() }
  Remove-Variable clip
  Set-Clipboard -Value " "
}
if (-not $env:BOT_TOKEN) {
  $secure = Read-Host "Paste the token for '$BotName' (input hidden)" -AsSecureString
  $env:BOT_TOKEN = [System.Net.NetworkCredential]::new("", $secure).Password
  Remove-Variable secure
}
if (-not $env:BOT_TOKEN) {
  Write-Error "No token entered."
  exit 2
}

$env:BOT_NAME = $BotName
if ($NoLobby) { $env:AUTO_LOBBY = "0" }
if ($NoTournament) { $env:AUTO_TOURNAMENT = "0" }
if ($Quiet) { $env:LOG_ROUNDS = "0" }
if ($LogFile) { $env:LOG_FILE = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($LogFile) }

if (-not (Test-Path "node_modules")) {
  Write-Host "Installing dependencies (first run)..."
  npm install
}

# The live server has switched modules before (RULES.md), and the SDK decodes
# rows by column position, so check the bindings against the live schema
# (read-only HTTP) and patch them if the server has drifted.
node scripts/check-live-schema.mjs
if ($LASTEXITCODE -eq 1) {
  node scripts/sync-live-bindings.mjs
  node scripts/check-live-schema.mjs
  if ($LASTEXITCODE -eq 1) {
    Write-Warning "The live schema changed in a way scripts/sync-live-bindings.mjs doesn't cover (see above). The bot may misread those tables."
  }
}

# Keep the system awake while this script runs (ES_CONTINUOUS | ES_SYSTEM_REQUIRED).
Add-Type -Namespace ScrabbleBot -Name Power -MemberDefinition @"
[System.Runtime.InteropServices.DllImport("kernel32.dll")]
public static extern uint SetThreadExecutionState(uint esFlags);
"@
[void][ScrabbleBot.Power]::SetThreadExecutionState([uint32]"0x80000001")

$restarts = 0
try {
  while ($true) {
    Write-Host "[$BotName] starting bot (restarts so far: $restarts)"
    npx tsx src/index.ts
    $code = $LASTEXITCODE
    if ($code -eq 2) {
      Write-Host "[$BotName] configuration error (see above); not restarting."
      exit 2
    }
    $restarts++
    Write-Host "[$BotName] bot exited with code $code; restarting in 5 s (Ctrl+C to stop)"
    Start-Sleep -Seconds 5
  }
}
finally {
  # Let Windows sleep again.
  [void][ScrabbleBot.Power]::SetThreadExecutionState([uint32]"0x80000000")
}
