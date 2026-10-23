# Contract 4.4's Windows run (increment_341abe802574): every 15 s, append one row to <out>\steps.tsv:
# the installed app's version (its exe's product version), its main process and start time, what the
# probe reads (agent activity, seed writing), whether a snapshot is being written (a .partial file in
# the home's backups), and the newest line of the home's releases.log. Stops when <out>\stop exists.
#   powershell -NoProfile -File watch.ps1 -AppHome <home> -InstallDir <dir> -Out <evidence dir>
param([Parameter(Mandatory)][string]$AppHome, [Parameter(Mandatory)][string]$InstallDir, [Parameter(Mandatory)][string]$Out)
$ErrorActionPreference = 'Continue'
$probe = Join-Path $PSScriptRoot 'probe.mjs'
Set-Location (Join-Path $PSScriptRoot '..\..\..')
$steps = Join-Path $Out 'steps.tsv'
if (-not (Test-Path $steps)) {
  [IO.File]::WriteAllText($steps, "utc`tversion`tapp_pid`tapp_started_utc`tagent_active_at`tseed_writing`tsnapshot_writing`treleases_log_last`n")
}
while (-not (Test-Path (Join-Path $Out 'stop'))) {
  $exe = Join-Path $InstallDir 'storytree-0.3.exe'
  $version = if (Test-Path $exe) { (Get-Item $exe).VersionInfo.ProductVersion } else { '' }
  $main = Get-CimInstance Win32_Process -Filter "Name = 'storytree-0.3.exe'" |
    Where-Object { $_.ExecutablePath -like "$InstallDir\*" -and $_.CommandLine -notmatch '--type=' } | Select-Object -First 1
  $started = if ($main) { $main.CreationDate.ToUniversalTime().ToString('o') } else { '' }
  $read = $null
  try { $read = (node --import tsx $probe $AppHome 2>$null | Select-Object -Last 1) | ConvertFrom-Json } catch {}
  $partial = @(Get-ChildItem -Recurse -Filter '*.partial' -Path (Join-Path $AppHome 'backups') -ErrorAction SilentlyContinue).Count -gt 0
  $logFile = Join-Path $AppHome 'releases.log'
  $last = if (Test-Path $logFile) { (Get-Content -Encoding UTF8 -Tail 1 $logFile) -replace "`t", ' ' } else { '' }
  $row = @((Get-Date).ToUniversalTime().ToString('o'), $version, $(if ($main) { $main.ProcessId } else { '' }), $started,
    $(if ($read) { $read.agentActiveAt } else { '' }), $(if ($read) { $read.seedWriting } else { '' }), $partial, $last) -join "`t"
  [IO.File]::AppendAllText($steps, "$row`n")
  Start-Sleep -Seconds 15
}
