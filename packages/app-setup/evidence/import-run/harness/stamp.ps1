# Version stamp and leftovers: the installed app's version, its processes' sessions, any st-* task, any update hold.
$exe = "$env:LOCALAPPDATA\Programs\storytree-0.3\storytree-0.3.exe"
"date $(Get-Date -Format o) app $((Get-Item $exe).VersionInfo.ProductVersion)"
"processes: " + ((Get-Process storytree-0.3 -EA SilentlyContinue | ForEach-Object { "$($_.Id)/s$($_.SessionId)" }) -join ' ')
"tasks: " + ((Get-ScheduledTask -EA SilentlyContinue | Where-Object TaskName -like 'st-*' | ForEach-Object TaskName) -join ' ')
"holds: " + ((Get-ChildItem "$HOME\.storytree\0.3\update-holds" -EA SilentlyContinue | ForEach-Object Name) -join ' ')
try { Invoke-WebRequest -UseBasicParsing http://127.0.0.1:9222/json -TimeoutSec 3 | Out-Null; 'debug port open' } catch { 'debug port closed' }
