# Captures the storytree app's window into st-shop\shots\<name>.png (run in the desktop session via start-task).
param([string]$Name)
& "$HOME\st-shop\appshot.ps1" -Out "$HOME\st-shop\shots\$Name.png"
