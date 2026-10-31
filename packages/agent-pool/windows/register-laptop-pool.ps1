# Capability 3 · Starts the laptop's dispatcher at login (ADR-1179 D1-D3). The owner runs this once, after reading it; nothing
# registers it for him. It first refuses, dry run included, a checkout with no install or from which the library or GitHub
# does not answer (a second clone of the project is refused by storytree: make a git worktree of the joined checkout instead).
# It writes the laptop's pool configuration (machine-only, one lane, Claude), or points an existing one at this checkout,
# forces the Claude engine in the lanes folder, and registers a Task Scheduler entry that runs laptop-pool.ps1 at his logon,
# first stopping a task already registered and the dispatcher it left running.
# The start rule (plugged in, online) is the dispatcher's own, so the task runs on battery too.
#   powershell -ExecutionPolicy Bypass -File packages\agent-pool\windows\register-laptop-pool.ps1 -DryRun
#   powershell -ExecutionPolicy Bypass -File packages\agent-pool\windows\register-laptop-pool.ps1
#   powershell -ExecutionPolicy Bypass -File packages\agent-pool\windows\register-laptop-pool.ps1 -Unregister
# Pause it by creating pool-stop in the lanes folder; delete that file to resume.
param(
  [string] $Checkout = 'C:\code\storytree03-dispatcher',
  [string] $Lanes = (Join-Path $env:USERPROFILE '.storytree\agent-pool'),
  [string] $Config = (Join-Path $env:USERPROFILE '.storytree\agent-pool.json'),
  [string] $TaskName = 'storytree laptop dispatcher',
  [switch] $DryRun,
  [switch] $Unregister
)

$ErrorActionPreference = 'Stop'
$user = "$env:USERDOMAIN\$env:USERNAME"

if ($Unregister) {
  if ($DryRun) { Write-Output "would unregister the task '$TaskName'"; return }
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Output "unregistered '$TaskName'; the configuration $Config and the lanes folder $Lanes are left as they are"
  return
}

$loop = Join-Path $Checkout 'packages\agent-pool\windows\laptop-pool.ps1'
if (-not (Test-Path -LiteralPath (Join-Path $Checkout 'packages\agent-pool\src\launch.mjs'))) { throw "$Checkout is not a storytree 0.3 checkout" }
$node = (Get-Command node -ErrorAction Stop).Source
$launch = 'packages\agent-pool\src\launch.mjs'
if (-not (Test-Path -LiteralPath (Join-Path $Checkout 'node_modules'))) { throw "$Checkout has no install: run pnpm install there first" }

# The dispatcher's own start-rule probe, run from the checkout: it names whichever of the library and GitHub refuses.
Push-Location -LiteralPath $Checkout
try { $said = & $node --import tsx $launch probe $Checkout; $probed = $LASTEXITCODE } finally { Pop-Location }
if ($probed -ne 0) { throw "the dispatcher cannot work from ${Checkout}: $($said -join '; ')" }
Write-Output ($said -join "`n")

# UTF-8 without a byte-order mark: JSON.parse refuses one.
function WriteText([string] $path, [string] $text) {
  if ($DryRun) { Write-Output "would write $path :"; Write-Output $text; return }
  [System.IO.File]::WriteAllText($path, $text)
  Write-Output "wrote $path"
}

if (-not (Test-Path -LiteralPath $Lanes)) {
  if ($DryRun) { Write-Output "would make the lanes folder $Lanes" } else { New-Item -ItemType Directory -Path $Lanes | Out-Null }
}
if (Test-Path -LiteralPath $Config) {
  $current = [System.IO.File]::ReadAllText($Config) | ConvertFrom-Json
  if ($current.checkout -eq $Checkout) {
    Write-Output "keeping the pool configuration already at $Config"
  } else {
    # Re-registered from another checkout: point the configuration at it, keeping its other fields.
    $current | Add-Member -NotePropertyName checkout -NotePropertyValue $Checkout -Force
    WriteText $Config ($current | ConvertTo-Json -Depth 8)
  }
} else {
  $settings = [ordered]@{
    about       = 'The laptop''s agent pool configuration (ADR-1179): machine-only, one lane, Claude. packages/agent-pool/src/pool-config.mjs says what each field means.'
    checkout    = $Checkout
    lanes       = $Lanes
    sessions    = 1
    machineOnly = $true
    engines     = @{ claude = @{ model = 'claude-opus-5-5' } }
  }
  WriteText $Config ($settings | ConvertTo-Json -Depth 4)
}
$override = Join-Path $Lanes 'engine-override'
if (-not (Test-Path -LiteralPath $override)) { WriteText $override 'claude' }

$secrets = Join-Path $env:USERPROFILE '.storytree\secrets.json'
if (-not ((Test-Path -LiteralPath $secrets) -and (Select-String -LiteralPath $secrets -Pattern 'CLAUDE_CODE_OAUTH_TOKEN' -Quiet))) {
  Write-Warning "no lane token in $secrets (CLAUDE_CODE_OAUTH_TOKEN): lanes will not start until one is there (claude setup-token)"
}

$arguments = "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$loop`" -Checkout `"$Checkout`" -Config `"$Config`" -Node `"$node`""
$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($DryRun) {
  if ($existing) { Write-Output "would stop the task '$TaskName' and the dispatcher it left running" }
  Write-Output "would register the task '$TaskName' for $user at logon: powershell.exe $arguments"
  return
}
if ($existing) {
  # Stopping the task ends its PowerShell loop, not the node dispatcher it started, which would keep the new one from starting.
  Stop-ScheduledTask -TaskName $TaskName
  $env:AGENT_POOL_CONFIG = $Config
  Push-Location -LiteralPath $Checkout
  try { & $node --import tsx $launch stop } finally { Pop-Location }
}
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments -WorkingDirectory $Checkout
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
$options = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero)
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $options -Principal $principal -Force | Out-Null
Write-Output "registered '$TaskName': it starts at your next logon (or now: Start-ScheduledTask -TaskName '$TaskName'); its status is in $(Join-Path $Lanes 'pool.status')"
