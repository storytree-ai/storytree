# Runs shop-turn.ps1 inside an update hold (packages/app/src/updates/hold-run.mjs, copied beside it), so the
# app does not reinstall itself under a working agent. Run it in the desktop task; it waits for the turn.
param([string]$N, [switch]$Fresh, [ValidateRange(1,360)][int]$Minutes = 120)
$ErrorActionPreference = 'Continue'
$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
$d = "$HOME\st-shop"
[string[]]$turnArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "$d\shop-turn.ps1", '-N', "$N")
if ($Fresh) { $turnArgs += '-Fresh' }
node "$d\hold-run.mjs" "$HOME\.storytree\0.3" "Shop turn $N" $Minutes powershell.exe @turnArgs
exit $LASTEXITCODE
