# The scheduled task's body: one turn under hold-run.mjs, so no automatic update installs mid-turn.
param([string]$P, [string]$N, [switch]$Fresh, [switch]$Approve, [int]$Minutes = 150)
$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
$d = "$HOME\st-redo"
[string[]]$a = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "$d\turn.ps1", '-P', $P, '-N', $N)
if ($Fresh) { $a += '-Fresh' }
if ($Approve) { $a += '-Approve' }
node "$d\hold-run.mjs" "$HOME\.storytree\0.3" "import run redo $P $N" $Minutes powershell.exe @a
