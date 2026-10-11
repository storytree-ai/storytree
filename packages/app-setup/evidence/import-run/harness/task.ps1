# Starts a one-shot interactive scheduled task in the desktop session and returns at once.
# Usage: task.ps1 <name> <script.ps1> [turn]; with a turn number the script gets -N <turn>.
# Poll with poll.ps1 <name>; it deletes the task when it ends.
param([string]$Name, [string]$Script, [int]$Turn = 0)
$d = "$HOME\st-import"
$cmd = "$d\$Name.cmd"
$more = if ($Turn -gt 0) { " -N $Turn" } else { '' }
Set-Content -LiteralPath $cmd -Encoding ascii -Value "@powershell -NoProfile -ExecutionPolicy Bypass -File `"$d\$Script`"$more > `"$d\$Name.stdout.txt`" 2>&1"
schtasks /create /tn "st-$Name" /tr "`"$cmd`"" /sc once /st 23:59 /it /f | Out-Null
schtasks /run /tn "st-$Name" | Out-Null
"started st-$Name"
