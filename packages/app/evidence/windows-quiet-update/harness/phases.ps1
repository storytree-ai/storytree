# Contract 4.4's Windows run (increment_341abe802574): drive the run's phases from the installed app's
# launch time T0, logging each to <out>\phases.tsv. Each rule is the only thing holding the update for
# a stretch after the ten-minute settle:
#   T+5 .. T+20  an agent session writes a line every 2 min (probe.mjs agent), so agents hold it to T+30
#   T+27         a real seed: `pnpm library:restore` of a large snapshot into the app's library, which
#                holds the seeds' writing lock (connection storytree-seed) for as long as it writes
#   seed's end   the window is shown and the mouse moved every 60 s for 10 min, so window use holds it
#   then         nothing: the app should install at its first check ten minutes after the last input
#   powershell -NoProfile -File phases.ps1 -AppHome <home> -InstallDir <dir> -Out <dir> -T0 <launch, unix seconds> [-Project <name>] -Snapshot <file> -Repo <checkout>
param([Parameter(Mandatory)][string]$AppHome, [Parameter(Mandatory)][string]$InstallDir, [Parameter(Mandatory)][string]$Out,
  [Parameter(Mandatory)][long]$T0, [string]$Project = 'storytree', [Parameter(Mandatory)][string]$Snapshot, [Parameter(Mandatory)][string]$Repo)
$ErrorActionPreference = 'Continue'
$phases = Join-Path $Out 'phases.tsv'
$start = [DateTimeOffset]::FromUnixTimeSeconds($T0).UtcDateTime
function Log([string]$what) { [IO.File]::AppendAllText($phases, "$((Get-Date).ToUniversalTime().ToString('o'))`t$what`n") }
function Until([double]$minutes) { $at = $start.AddMinutes($minutes); while ((Get-Date).ToUniversalTime() -lt $at) { Start-Sleep -Seconds 5 } }
function Installed { (Get-Item (Join-Path $InstallDir 'storytree-0.3.exe')).VersionInfo.ProductVersion }
Add-Type @'
using System; using System.Runtime.InteropServices;
public static class Nudge {
  [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx, dy; public uint data, flags, time; public IntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public MOUSEINPUT mi; }
  [DllImport("user32.dll")] static extern uint SendInput(uint n, INPUT[] inputs, int size);
  public static uint Move(int dx) { var i = new INPUT[1]; i[0].type = 0; i[0].mi.dx = dx; i[0].mi.flags = 1; return SendInput(1, i, Marshal.SizeOf(typeof(INPUT))); }
}
'@
if (-not (Test-Path $phases)) { [IO.File]::WriteAllText($phases, "utc`tphase`n") }
$env:STORYTREE_HOME = $AppHome
Set-Location (Join-Path $Repo 'packages\app')
$probe = Join-Path $PSScriptRoot 'probe.mjs'

Log "start; T0 $($start.ToString('o')); installed $(Installed)"
Until 5
Log 'agent: session acceptance-agent-1 starts writing a line every 2 min'
while ((Get-Date).ToUniversalTime() -lt $start.AddMinutes(20)) {
  $r = node --import tsx $probe $AppHome agent acceptance-agent-1 2>&1 | Select-Object -Last 1
  Log "agent line: $r; installed $(Installed)"
  Start-Sleep -Seconds 120
}
Log "agent: last line written; agents hold the update until 10 min after it; installed $(Installed)"
Until 27
Log "seed: pnpm library:restore $Snapshot --project $Project starts; installed $(Installed)"
Set-Location $Repo
$seed = pnpm -s library:restore $Snapshot --project $Project 2>&1 | Out-String
[IO.File]::WriteAllText((Join-Path $Out 'seed.txt'), $seed)
Log "seed: restore ended (output in seed.txt); installed $(Installed)"
Set-Location (Join-Path $Repo 'packages\app')
Start-Process -FilePath (Join-Path $InstallDir 'storytree-0.3.exe')
Log "window: opened the installed app again (second start shows its window); installed $(Installed)"
$windowUntil = (Get-Date).ToUniversalTime().AddMinutes(10)
while ((Get-Date).ToUniversalTime() -lt $windowUntil) {
  [void][Nudge]::Move(1); Start-Sleep -Milliseconds 200; [void][Nudge]::Move(-1)
  Log "window: mouse moved (window input); installed $(Installed)"
  Start-Sleep -Seconds 60
}
Log "window: last input written by the harness; quiet from here; installed $(Installed)"
$deadline = (Get-Date).ToUniversalTime().AddMinutes(25)
$before = Installed
while ((Get-Date).ToUniversalTime() -lt $deadline -and (Installed) -eq $before) { Start-Sleep -Seconds 10 }
Log "quiet: installed $(Installed) (was $before)"
