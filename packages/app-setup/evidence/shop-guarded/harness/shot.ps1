# Captures the storytree app's window into st-guard\shots\<name>.png (run in the desktop session via start-task).
param([string]$Name)
New-Item -ItemType Directory -Force "$HOME\st-guard\shots" | Out-Null
& "$HOME\st-guard\appshot.ps1" -Out "$HOME\st-guard\shots\$Name.png"
