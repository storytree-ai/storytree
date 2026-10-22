# Contract 4.4's Windows run (increment_341abe802574), run 3: a seed alone holds the update. In run 1
# the seeds ended within one updater check of the other holds, so this run isolates the seed:
#  1. quit the installed app (`--quit`), reinstall 0.3.1690 silently over the updated app
#  2. launch it in the background (no window, so window use cannot hold it); no agent writes here
#  3. at T+SeedAtMinutes start seed-queue.ps1, whose restores keep a seed writing well past the settle
#  4. the app should install at its first check after the last restore ends
#   powershell -NoProfile -File seed-run.ps1 -AppHome <home> -InstallDir <dir> -Out <dir> -Setup <old setup.exe> -Snapshot <file> -Repo <checkout>
param([Parameter(Mandatory)][string]$AppHome, [Parameter(Mandatory)][string]$InstallDir, [Parameter(Mandatory)][string]$Out,
  [Parameter(Mandatory)][string]$Setup, [Parameter(Mandatory)][string]$Snapshot, [Parameter(Mandatory)][string]$Repo,
  [int]$SeedAtMinutes = 8, [int]$Count = 14)
$ErrorActionPreference = 'Continue'
$env:STORYTREE_HOME = $AppHome
$exe = Join-Path $InstallDir 'storytree-0.3.exe'
New-Item -ItemType Directory -Force $Out | Out-Null
$phases = Join-Path $Out 'phases.tsv'
[IO.File]::WriteAllText($phases, "utc`tphase`n")
function Installed { (Get-Item $exe -ErrorAction SilentlyContinue).VersionInfo.ProductVersion }
function Log([string]$what) { [IO.File]::AppendAllText($phases, "$((Get-Date).ToUniversalTime().ToString('o'))`t$what`n") }

Log "before: installed $(Installed)"
& $exe --quit | Out-Null
$deadline = (Get-Date).AddMinutes(2)
while ((Get-CimInstance Win32_Process -Filter "Name = 'storytree-0.3.exe'" | Where-Object { $_.ExecutablePath -like "$InstallDir\*" }) -and (Get-Date) -lt $deadline) { Start-Sleep 2 }
Log 'quit: the installed app has stopped'
$p = Start-Process -FilePath $Setup -ArgumentList "/S /D=$InstallDir" -PassThru -Wait
Log "reinstalled $Setup (exit $($p.ExitCode)): installed $(Installed)"
$launch = (Get-Date).ToUniversalTime()
[IO.File]::WriteAllText((Join-Path $Out 't0.txt'), $launch.ToString('o'))
Start-Process -FilePath $exe -ArgumentList '--background'
Log 'launched in the background (no window)'
Start-Process powershell -WindowStyle Hidden -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$(Join-Path $PSScriptRoot 'capture-reopen.ps1')`" -InstallDir `"$InstallDir`" -Out `"$Out`" -WaitSeconds 1500"
& (Join-Path $PSScriptRoot 'seed-queue.ps1') -AppHome $AppHome -Out $Out -Snapshot $Snapshot -Repo $Repo -Count $Count -Prefix storytree-seed-r -At $launch.AddMinutes($SeedAtMinutes).ToString('o')
$before = Installed
$deadline = (Get-Date).AddMinutes(12)
while ((Installed) -eq $before -and (Get-Date) -lt $deadline) { Start-Sleep 5 }
Log "after: installed $(Installed) (was $before)"
Start-Sleep 90  # let the installer finish and reopen
Copy-Item (Join-Path $AppHome 'pgdata.log') (Join-Path $Out 'pgdata-log.txt')
