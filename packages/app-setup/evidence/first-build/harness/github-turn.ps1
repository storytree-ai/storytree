# Run through start-task.ps1 in the desktop session; poll its meta file and delete the task.
param([int]$N, [switch]$Fresh, [string]$SessionId)
$ErrorActionPreference = 'Stop'
if ($N -gt 1 -and -not $Fresh -and -not $SessionId) {
  throw 'Pass the builder thread ID with -SessionId; --last can select its approval reviewer.'
}
$trial = "$HOME\st-firstbuild"
$exe = "$env:LOCALAPPDATA\Programs\storytree-0.3\storytree-0.3.exe"
$versions = "$trial\runs\github-codex-$N-versions.txt"
"before $(Get-Date -Format o) $((Get-Item $exe).VersionInfo.ProductVersion)" | Set-Content $versions
try {
  # Windows PowerShell treats native stderr as an error record. Let Codex
  # handle an approval refusal itself instead of terminating its JSON stream.
  & {
    $ErrorActionPreference = 'Continue'
    & "$trial\turn.ps1" github-codex $N "$HOME\conduit-codex" -Fresh:$Fresh -SessionId $SessionId
  }
} finally {
  "after $(Get-Date -Format o) $((Get-Item $exe).VersionInfo.ProductVersion)" | Add-Content $versions
}
