# Starts a PowerShell input file in the logged-on desktop session (scheduled task /IT) and returns at once.
# Usage: start-task.ps1 <name> <inputfile>. Delete the task afterwards with: schtasks /delete /tn st-<name> /f
param([string]$Name, [string]$InputFile)
$dir = "$HOME\st-shop"
$cmd = "$dir\$Name.cmd"
Set-Content -LiteralPath $cmd -Encoding ascii -Value "@powershell -NoProfile -ExecutionPolicy Bypass -Command - < `"$InputFile`" > `"$dir\$Name.stdout.txt`" 2>&1"
schtasks /create /tn "st-$Name" /tr "`"$cmd`"" /sc once /st 23:59 /it /f | Out-Null
schtasks /run /tn "st-$Name" | Out-Null
"started st-$Name"
