# One user turn for a laptop agent, run in the desktop session. Usage: turn.ps1 <claude|codex> <n> <folder>
# Reads prompts\<agent>-<n>.txt; turn 1 starts a session, later turns continue the latest one in the folder.
# For Codex, pass -SessionId to resume the builder explicitly: --last can select its approval reviewer.
param([string]$Agent, [int]$N, [string]$Folder, [switch]$Fresh, [string]$SessionId)
$d = "$HOME\st-firstbuild"
$out = "$d\runs\$Agent"
New-Item -ItemType Directory -Force $out | Out-Null
New-Item -ItemType Directory -Force $Folder | Out-Null
Set-Location -LiteralPath $Folder
$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
$OutputEncoding = New-Object System.Text.UTF8Encoding $false
$prompt = Get-Content -Raw "$d\prompts\$Agent-$N.txt"
$t = Get-Date
"start $(Get-Date -Format o)" | Set-Content "$out\turn-$N.meta.txt"
if ($Agent -like "*claude*") {
  $more = if ($N -gt 1 -and -not $Fresh) { @('--continue') } else { @() }
  $prompt | claude -p @more --permission-mode bypassPermissions --output-format stream-json --verbose > "$out\turn-$N.jsonl" 2>&1
} else {
  # Codex as a user runs it: automatic approval review (workspace-write sandbox), JSON events for the record.
  if ($N -gt 1 -and -not $Fresh) {
    [string[]]$resumeArgs = if ($SessionId) { @($SessionId) } else { @('--last') }
    $prompt | codex exec --skip-git-repo-check --approve-for-me --json resume @resumeArgs - > "$out\turn-$N.jsonl" 2>&1
  }
  else { $prompt | codex exec --skip-git-repo-check --approve-for-me --json - > "$out\turn-$N.jsonl" 2>&1 }
}
"exit $LASTEXITCODE seconds $([int]((Get-Date) - $t).TotalSeconds) end $(Get-Date -Format o)" | Add-Content "$out\turn-$N.meta.txt"
