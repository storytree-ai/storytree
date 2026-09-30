# Runs journey.ps1 in the owner's logged-on desktop session through a one-shot interactive scheduled
# task, waits for it, and ALWAYS deletes the task (a task left behind fires again at its /st time).
# Usage: run-task.ps1 <stamp> [timeoutMinutes]
param([string]$Stamp, [int]$Minutes = 25)
$dir = "$HOME\st-accept-run"
$out = "$dir\out-$Stamp"
$task = "st-accept-$Stamp"
$cmd = "$dir\$task.cmd"
Set-Content -LiteralPath $cmd -Encoding ascii -Value "@powershell -NoProfile -ExecutionPolicy Bypass -File `"$dir\journey.ps1`" `"$out`" $Stamp > `"$dir\$task.log`" 2>&1"
schtasks /create /tn $task /tr "`"$cmd`"" /sc once /st 23:59 /it /f | Out-Null
schtasks /run /tn $task | Out-Null
$deadline = (Get-Date).AddMinutes($Minutes)
do { Start-Sleep 5; $s = (schtasks /query /tn $task /fo csv /v | ConvertFrom-Csv).'Last Result' } while ($s -eq '267009' -and (Get-Date) -lt $deadline)
if ($s -eq '267009') { schtasks /end /tn $task | Out-Null; "timed out: task ended" }
schtasks /delete /tn $task /f | Out-Null
"task last result: $s"
