# Copy packages/app/src/updates/hold-run.mjs beside this script first.
# Run this wrapper in the desktop task: it waits for the whole Codex turn.
param([int]$N, [switch]$Fresh, [string]$SessionId, [ValidateRange(1,360)][int]$Minutes = 180)
$ErrorActionPreference = 'Continue'
$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
$trial = "$HOME\st-firstbuild"
[string[]]$turnArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "$trial\github-turn.ps1", '-N', "$N")
if ($Fresh) { $turnArgs += '-Fresh' }
if ($SessionId) { $turnArgs += @('-SessionId', $SessionId) }
node "$trial\hold-run.mjs" "$HOME\.storytree\0.3" "Conduit Codex turn $N" $Minutes powershell.exe @turnArgs
exit $LASTEXITCODE
