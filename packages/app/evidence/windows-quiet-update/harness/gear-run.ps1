# Contract 4.4's Windows run (increment_341abe802574), run 2 (and, with -NoSnapshot, run 2b: the click with nothing holding it): the gear's Restart to update installs at
# once, inside the ten-minute settle, but a snapshot being written still holds it.
#  1. quit the installed app (`--quit`), reinstall 0.3.1690 silently over the updated app
#  2. make the large project's daily snapshot fall due LeadMinutes after launch: its snapshots move
#     aside and one whole stand-in, named a day before that moment, takes their place, so the app's
#     own daily timer (keepBackups) writes a real snapshot then
#  3. launch with its window and --remote-debugging-port, wait for the release to download (pending)
#     and for the snapshot's .partial file, then press the gear's button (gear.mjs click)
#  4. log the gear's status every 5 s to gear.tsv until the installed version changes
#   powershell -NoProfile -File gear-run.ps1 -AppHome <home> -InstallDir <dir> -Out <dir> -Setup <old setup.exe> -Project <name[,name...]>
param([Parameter(Mandatory)][string]$AppHome, [Parameter(Mandatory)][string]$InstallDir, [Parameter(Mandatory)][string]$Out,
  [Parameter(Mandatory)][string]$Setup, [string]$Project = '', [int]$LeadMinutes = 4, [int]$Port = 9333, [switch]$NoSnapshot)
$ErrorActionPreference = 'Continue'
$env:STORYTREE_HOME = $AppHome
$exe = Join-Path $InstallDir 'storytree-0.3.exe'
$gearJs = Join-Path $PSScriptRoot 'gear.mjs'
New-Item -ItemType Directory -Force $Out | Out-Null
$gearLog = Join-Path $Out 'gear.tsv'
[IO.File]::WriteAllText($gearLog, "utc`twhat`tsnapshot_writing`tversion`tread`n")
function Installed { (Get-Item $exe).VersionInfo.ProductVersion }
function Writing { @(Get-ChildItem -Recurse -Filter '*.partial' -Path (Join-Path $AppHome 'backups') -ErrorAction SilentlyContinue).Count -gt 0 }
function Gear([string]$verb) { $r = (node $gearJs $Port $verb 2>&1 | Out-String).Trim() -replace "`r?`n", ' '; [IO.File]::AppendAllText($gearLog, "$((Get-Date).ToUniversalTime().ToString('o'))`t$verb`t$(Writing)`t$(Installed)`t$r`n"); $r }
function Note([string]$what) { [IO.File]::AppendAllText($gearLog, "$((Get-Date).ToUniversalTime().ToString('o'))`tnote`t$(Writing)`t$(Installed)`t$what`n") }

Note "before: installed $(Installed)"
& $exe --quit | Out-Null
$deadline = (Get-Date).AddMinutes(2)
while ((Get-CimInstance Win32_Process -Filter "Name = 'storytree-0.3.exe'" | Where-Object { $_.ExecutablePath -like "$InstallDir\*" }) -and (Get-Date) -lt $deadline) { Start-Sleep 2 }
Note 'quit: the installed app has stopped'
$p = Start-Process -FilePath $Setup -ArgumentList "/S /D=$InstallDir" -PassThru -Wait
Note "reinstalled $Setup (exit $($p.ExitCode)): installed $(Installed)"

$launch = (Get-Date).ToUniversalTime()
$due = $launch.AddMinutes($LeadMinutes).AddDays(-1)
foreach ($one in @($Project -split ',' | Where-Object { $_ -ne '' -and -not $NoSnapshot })) {
  $folder = Join-Path $AppHome "backups\$one"
  $aside = Join-Path $AppHome "backups-aside\$one"
  New-Item -ItemType Directory -Force $aside, $folder | Out-Null
  Get-ChildItem $folder -Filter '*.json' | Move-Item -Destination $aside -Force
  $standIn = Join-Path $folder ($due.ToString('yyyy-MM-ddTHH-mm-ss-fff') + 'Z.json')
  [IO.File]::WriteAllText($standIn, "{}`n")
  Note "snapshot: $one's snapshots moved to $aside; stand-in $standIn makes its daily snapshot due at $($launch.AddMinutes($LeadMinutes).ToString('o'))"
}

[IO.File]::WriteAllText((Join-Path $Out 't0.txt'), $launch.ToString('o'))
Start-Process -FilePath $exe -ArgumentList "--remote-debugging-port=$Port"
Note "launched with its window and a debugging port"
$deadline = (Get-Date).AddMinutes(9)
do { Start-Sleep 5; $r = Gear status } until ($r -match '"button":"Restart to update"' -or (Get-Date) -gt $deadline)
if (-not $NoSnapshot) { do { Start-Sleep 1 } until ((Writing) -or (Get-Date) -gt $deadline) }
Note "the snapshot is being written: $(Writing)"
Start-Process powershell -WindowStyle Hidden -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$(Join-Path $PSScriptRoot 'capture-reopen.ps1')`" -InstallDir `"$InstallDir`" -Out `"$Out`" -WaitSeconds 1500"
Gear click | Out-Null
$deadline = (Get-Date).AddMinutes(10)
$before = Installed
while ((Installed) -eq $before -and (Get-Date) -lt $deadline) { Start-Sleep 5; try { Gear status | Out-Null } catch { Note "gear unreadable (the app is restarting?)" } }
Note "after: installed $(Installed)"
Start-Sleep 90  # let the installer finish and reopen
Copy-Item (Join-Path $AppHome 'pgdata.log') (Join-Path $Out 'pgdata-log.txt')
& (Join-Path $PSScriptRoot 'list-snapshots.ps1') -AppHome $AppHome -Out $Out
