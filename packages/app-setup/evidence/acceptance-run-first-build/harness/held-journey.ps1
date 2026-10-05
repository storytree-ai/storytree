# Runs journey.ps1 under the app's update hold (process_81a7122f6849 step 19), so a quiet-moment install does
# not restart storytree mid-turn. Copy packages/app/src/updates/hold-run.mjs beside this script first.
# run-task.ps1 starts it in the desktop session: run-task.ps1 <stamp> <minutes> held-journey.ps1
param([string]$Out, [string]$Stamp)
$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
node "$dir\hold-run.mjs" "$HOME\.storytree\0.3" "First build $Stamp" 240 powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$dir\journey.ps1" $Out $Stamp
exit $LASTEXITCODE
