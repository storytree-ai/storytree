# Prints a task's Last Result; once it is no longer 267009 (running) the task is deleted. Usage: poll.ps1 <name>
param([string]$Name)
$q = schtasks /query /tn "st-$Name" /fo csv /v 2>$null | ConvertFrom-Csv
if (-not $q) { 'gone'; exit }
$s = $q.'Last Result'
if ($s -eq '267009') { 'running' } else { schtasks /delete /tn "st-$Name" /f | Out-Null; "done $s (task deleted)" }
