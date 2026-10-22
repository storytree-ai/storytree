# Contract 4.4's Windows run (increment_341abe802574): the app's own record of its snapshot passes.
# Each snapshot file is named for the moment its pass began (keepBackups names a pass's files alike)
# and its write time is when that project's snapshot was complete, so a pass runs from its name's
# time to its last file's write. Writes <out>\snapshots.tsv; the run's stand-ins (3-byte "{}") are listed too.
#   powershell -NoProfile -File list-snapshots.ps1 -AppHome <home> -Out <dir>
param([Parameter(Mandatory)][string]$AppHome, [Parameter(Mandatory)][string]$Out)
$rows = @("project`tfile`tbytes`tpass_began_utc`tcreated_utc`twritten_utc")
Get-ChildItem -Recurse (Join-Path $AppHome 'backups') -File -Filter '*.json' | Sort-Object LastWriteTime | ForEach-Object {
  $m = [regex]::Match($_.Name, '^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.json$')
  $began = if ($m.Success) { "$($m.Groups[1].Value)T$($m.Groups[2].Value):$($m.Groups[3].Value):$($m.Groups[4].Value).$($m.Groups[5].Value)Z" } else { '' }
  $rows += @($_.Directory.Name, $_.Name, $_.Length, $began, $_.CreationTime.ToUniversalTime().ToString('o'), $_.LastWriteTime.ToUniversalTime().ToString('o')) -join "`t"
}
[IO.File]::WriteAllText((Join-Path $Out 'snapshots.tsv'), ($rows -join "`n") + "`n")
