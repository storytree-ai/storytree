# Runs a PowerShell input file in the owner's logged-on desktop session (scheduled task /IT),
# feeding the file on stdin so Read-Host answers come from it. Usage: run-interactive.ps1 <name> <inputfile> [timeoutMinutes]
param([string]$Name, [string]$InputFile, [int]$Minutes = 20)
$dir = "$HOME\st-habits"
New-Item -ItemType Directory -Force $dir | Out-Null
$cmd = "$dir\$Name.cmd"
Set-Content -LiteralPath $cmd -Encoding ascii -Value "@powershell -NoProfile -ExecutionPolicy Bypass -Command - < `"$InputFile`" > `"$dir\$Name.stdout.txt`" 2>&1"
schtasks /create /tn "st-$Name" /tr "`"$cmd`"" /sc once /st 23:59 /it /f | Out-Null
schtasks /run /tn "st-$Name" | Out-Null
$deadline = (Get-Date).AddMinutes($Minutes)
do { Start-Sleep 5; $s = (schtasks /query /tn "st-$Name" /fo csv /v | ConvertFrom-Csv).'Last Result' } while ($s -eq '267009' -and (Get-Date) -lt $deadline)
"task last result: $s"
if ($s -eq '267009') { 'STILL RUNNING at timeout (left running)' } else { schtasks /delete /tn "st-$Name" /f | Out-Null }
