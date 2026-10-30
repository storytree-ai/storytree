# Capability 3 · The laptop's dispatcher loop (ADR-1179 D1, D3): what the logon task register-laptop-pool.ps1 makes runs.
# It runs launch.mjs pool in the laptop's checkout with the laptop's pool configuration, as the Mint box's launch-pool.sh
# does there: started again at once when its own code changed (exit 3), after a pause otherwise, and paused while the lanes
# folder's pool-stop exists (the dispatcher ends on it once its running lane ends; delete the file to resume).
param(
  [Parameter(Mandatory = $true)] [string] $Checkout,
  [Parameter(Mandatory = $true)] [string] $Config,
  [string] $Node = 'node'
)

$ErrorActionPreference = 'Continue'
$env:AGENT_POOL_CONFIG = $Config
$lanes = ([System.IO.File]::ReadAllText($Config) | ConvertFrom-Json).lanes
if (-not $lanes) { $lanes = Join-Path $env:USERPROFILE '.storytree\agent-pool' }
$stop = Join-Path $lanes 'pool-stop'
$log = Join-Path $lanes 'pool-loop.log'

function Say([string] $message) {
  $at = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
  [System.IO.File]::AppendAllText($log, "$at $message`n")
}

Set-Location -LiteralPath $Checkout
Say "dispatcher loop started in $Checkout"
$paused = $false
while ($true) {
  if (Test-Path -LiteralPath $stop) {
    if (-not $paused) { Say 'paused by pool-stop'; $paused = $true }
    Start-Sleep -Seconds 60
    continue
  }
  if ($paused) { Say 'pool-stop removed: resuming'; $paused = $false }
  & $Node --import tsx packages/agent-pool/src/launch.mjs pool 2>&1 | ForEach-Object { Say "$_" }
  $code = $LASTEXITCODE
  Say "dispatcher exited $code"
  if ($code -eq 3) { continue }                              # its own code changed: start again on the new code
  if ($code -eq 75) { Start-Sleep -Seconds 900; continue }   # an engine failing at once: look again in a quarter hour
  Start-Sleep -Seconds 60                                    # stopped (0), another dispatcher running (1), or a crash
}
