# Starts a one-shot interactive scheduled task in the desktop session and returns at once. Arguments are written
# into the task's .cmd, never passed through ssh and cmd quoting. Usage: task.ps1 <name> <script.ps1> [plain args...]
# Poll with poll.ps1 <name>; it deletes the task when it ends.
$Name, $Script, $Rest = $args
$d = "$HOME\st-redo"
$cmd = "$d\$Name.cmd"
$more = if ($Rest) { ' ' + (@($Rest) -join ' ') } else { '' }
Set-Content -LiteralPath $cmd -Encoding ascii -Value "@powershell -NoProfile -ExecutionPolicy Bypass -File `"$d\$Script`"$more > `"$d\$Name.stdout.txt`" 2>&1"
schtasks /create /tn "st-$Name" /tr "`"$cmd`"" /sc once /st 23:59 /it /f | Out-Null
schtasks /run /tn "st-$Name" | Out-Null
"started st-$Name"
