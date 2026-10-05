# Runs lane-turn.ps1 inside an update hold (hold-run.mjs from ../../shop/harness), so the app does not reinstall
# itself under a working agent. Each lane holds its own lease; updates wait until every lane's turn has ended.
param([string]$Turn, [string]$Resume = '', [ValidateRange(1,360)][int]$Minutes = 120)
$ErrorActionPreference = 'Continue'
$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
$d = "$HOME\st-guard"
[string[]]$turnArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "$d\lane-turn.ps1", '-Turn', "$Turn")
if ($Resume) { $turnArgs += @('-Resume', "$Resume") }
node "$d\hold-run.mjs" "$HOME\.storytree\0.3" "Shop lane $Turn" $Minutes powershell.exe @turnArgs
exit $LASTEXITCODE
