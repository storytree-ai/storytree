# The scheduled task's body: one turn under hold-run.mjs, so no automatic update installs mid-turn.
param([int]$N, [switch]$Fresh, [int]$Minutes = 150)
$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
$d = "$HOME\st-import"
[string[]]$a = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "$d\turn.ps1", '-N', "$N")
if ($Fresh) { $a += '-Fresh' }
node "$d\hold-run.mjs" "$HOME\.storytree\0.3" "import run turn $N" $Minutes powershell.exe @a
