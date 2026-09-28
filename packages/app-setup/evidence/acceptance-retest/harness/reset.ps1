# Returns the laptop to a first-user state for the retest (round 0 of the retest brief). Never touches Reolink.
$ErrorActionPreference = 'Continue'
$un = "$env:LOCALAPPDATA\Programs\storytree-0.3\Uninstall storytree-0.3.exe"
if (Test-Path $un) { "uninstall storytree"; Start-Process -Wait -FilePath $un -ArgumentList '/S'; Start-Sleep 5 }
"app folder after: " + (Test-Path "$env:LOCALAPPDATA\Programs\storytree-0.3")
foreach ($p in "$HOME\.storytree\0.3", "$env:LOCALAPPDATA\@storytreedesktop-updater", "$HOME\.codex") { if (Test-Path $p) { Remove-Item -Recurse -Force -LiteralPath $p; "removed $p" } }
if ((Test-Path "$HOME\.storytree") -and -not (Get-ChildItem -Force "$HOME\.storytree")) { Remove-Item -Force "$HOME\.storytree"; "removed empty ~\.storytree" }
$up = [Environment]::GetEnvironmentVariable('Path','User')
$new = ($up -split ';' | Where-Object { $_ -and $_ -notlike '*\.storytree\0.3\bin*' }) -join ';'
if ($new -ne $up) { [Environment]::SetEnvironmentVariable('Path', $new, 'User'); "user PATH: storytree bin removed" }
"claude mcp remove"
& "$HOME\.local\bin\claude.exe" mcp remove storytree -s user 2>&1
Copy-Item -Force "$HOME\.claude\settings.json" "$HOME\st-retest\claude-settings.before.json"
Copy-Item -Force "$HOME\st-retest\claude-settings-clean.json" "$HOME\.claude\settings.json"
"claude settings.json now: " + (Get-Content -Raw "$HOME\.claude\settings.json")
foreach ($id in 'Git.Git','OpenJS.NodeJS.LTS','GitHub.cli') { "winget uninstall $id"; winget uninstall --id $id -e --disable-interactivity --silent --accept-source-agreements 2>&1 | Select-Object -Last 2 }
foreach ($p in @('My First Project','Second Folder With Spaces','claude trial','claude trial 2','codex trial' | ForEach-Object { "$HOME\$_" }) + @(Get-ChildItem -Directory "$HOME\Retest *" -EA SilentlyContinue | ForEach-Object FullName)) { if (Test-Path -LiteralPath $p) { Remove-Item -Recurse -Force -LiteralPath $p; "removed $p" } }
if (Test-Path "$HOME\st-evidence") { Rename-Item "$HOME\st-evidence" 'st-evidence-run1'; 'renamed st-evidence to st-evidence-run1' }
