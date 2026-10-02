# What Codex's automatic approval reviewer saw and decided, from its own session records in the trial's
# CODEX_HOME (the sessions whose prompt says "whose request action you are assessing"): for each review, the
# action under review and the reviewer's final answer. Usage: reviews.ps1 <label>
param([string]$Label)
$files = Get-ChildItem -Recurse "$HOME\st-second\home-$Label\sessions" -Filter *.jsonl |
  Where-Object { Select-String -Path $_.FullName -Pattern 'whose request action you are assessing' -SimpleMatch -Quiet } | Sort-Object LastWriteTime
foreach ($file in $files) {
  "=== $($file.Name)"
  Get-Content -Raw $file.FullName
}
