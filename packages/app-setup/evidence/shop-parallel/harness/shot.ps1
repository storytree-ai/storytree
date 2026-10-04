# Captures the storytree app's window into st-par\shots\<name>.png (run in the desktop session via start-task).
param([string]$Name)
New-Item -ItemType Directory -Force "$HOME\st-par\shots" | Out-Null
& "$HOME\st-par\appshot.ps1" -Out "$HOME\st-par\shots\$Name.png"
