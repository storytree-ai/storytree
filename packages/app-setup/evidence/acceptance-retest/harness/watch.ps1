# One observation of the installed app: processes, window (captured alone) and the release log's tail. Runs in the desktop session.
param([string]$Label, [string]$Dir)
"=== $Label at $(Get-Date -Format o)"
Get-Process | Where-Object { $_.ProcessName -match 'storytree|postgres' } | Group-Object ProcessName | ForEach-Object { "$($_.Name): $($_.Count) (started $((($_.Group | Sort-Object StartTime | Select-Object -First 1).StartTime).ToString('HH:mm:ss')))" }
"version: $((Get-Item "$env:LOCALAPPDATA\Programs\storytree-0.3\storytree-0.3.exe").VersionInfo.ProductVersion)"
& "$HOME\st-retest\screen-app.ps1" -Out "$Dir\app-$Label.png"
"releases.log tail:"
Get-Content "$HOME\.storytree\0.3\releases.log" -Tail 6 -EA SilentlyContinue
