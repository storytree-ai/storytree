# Contract 4.4's Windows run (increment_341abe802574): a seed that outlasts the updater's three-minute
# check. One restore of the large snapshot takes about 80 s here, so <Count> restores start together,
# each into its own new project: the first takes the seeds' writing lock and the rest wait for it on
# their own storytree-seed connections, so the app's library reads "a seed is writing" without a gap
# until the last one finishes. Logs to <out>\phases.tsv; each restore's output to seed-queue-<n>.txt.
#   powershell -NoProfile -File seed-queue.ps1 -AppHome <home> -Out <dir> -Snapshot <file> -Repo <checkout> [-Count 4] [-At <utc iso>] [-Prefix <project name prefix>]
param([Parameter(Mandatory)][string]$AppHome, [Parameter(Mandatory)][string]$Out, [Parameter(Mandatory)][string]$Snapshot,
  [Parameter(Mandatory)][string]$Repo, [int]$Count = 4, [string]$At = '', [string]$Prefix = 'storytree-seed-q')
$ErrorActionPreference = 'Continue'
$phases = Join-Path $Out 'phases.tsv'
function Log([string]$what) { [IO.File]::AppendAllText($phases, "$((Get-Date).ToUniversalTime().ToString('o'))`t$what`n") }
if ($At -ne '') { $when = [DateTimeOffset]::Parse($At).UtcDateTime; while ((Get-Date).ToUniversalTime() -lt $when) { Start-Sleep -Seconds 5 } }
$env:STORYTREE_HOME = $AppHome
Log "seed-queue: $Count restores of $Snapshot start together, into $Prefix`1..$Prefix$Count"
$jobs = 1..$Count | ForEach-Object {
  $n = $_
  Start-Process -FilePath 'cmd.exe' -WorkingDirectory $Repo -WindowStyle Hidden -PassThru `
    -ArgumentList "/c pnpm -s library:restore `"$Snapshot`" --project $Prefix$n > `"$(Join-Path $Out "seed-queue-$n.txt")`" 2>&1"
}
$jobs | Wait-Process
Log "seed-queue: all $Count restores ended"
