# One user turn of Claude Code in trial project <P>, run in the desktop session under an update hold.
# Usage: turn.ps1 -P <a|b> -N <prompt name> [-Fresh]. Reads prompts\<name>.txt. -Fresh starts a session and records
# its id in runs\<P>.session.txt; otherwise the turn resumes that exact session. -Approve answers each permission prompt
# yes to file edits through approver.mjs, standing in for the user's click.
param([string]$P, [string]$N, [switch]$Fresh, [switch]$Approve)
$d = "$HOME\st-redo"
$folder = "$d\$P\reddit-stats-$P"
$out = "$d\runs"
New-Item -ItemType Directory -Force $out | Out-Null
Set-Location -LiteralPath $folder
$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
$OutputEncoding = New-Object System.Text.UTF8Encoding $false
$prompt = Get-Content -Raw "$d\prompts\$N.txt"
$exe = "$env:LOCALAPPDATA\Programs\storytree-0.3\storytree-0.3.exe"
$t = Get-Date
$tag = "$P-$N"
$more = @()
if (-not $Fresh) { $more = @('--resume', (Get-Content "$out\$P.session.txt").Trim()) }
"start $(Get-Date -Format o) app $((Get-Item $exe).VersionInfo.ProductVersion) args $($more -join ' ')" | Set-Content "$out\$tag.meta.txt"
if ($Approve) {
  # The user's yes at each permission prompt: approver.mjs, logged to runs\<P>-<N>.prompts.jsonl.
  $cfg = "$out\$tag.mcp.json"
  $log = ("$out\$tag.prompts.jsonl") -replace '\\', '/'
  $srv = ("$d\approver.mjs") -replace '\\', '/'
  Set-Content -LiteralPath $cfg -Encoding ascii -Value ('{"mcpServers":{"user":{"command":"node","args":["' + $srv + '","' + $log + '"]}}}')
  $more += @('--mcp-config', $cfg, '--permission-prompt-tool', 'mcp__user__approve')
}
$ErrorActionPreference = 'Continue'
$prompt | claude -p @more --permission-mode bypassPermissions --output-format stream-json --verbose > "$out\$tag.jsonl" 2>&1
$code = $LASTEXITCODE
"exit $code seconds $([int]((Get-Date) - $t).TotalSeconds) end $(Get-Date -Format o) app $((Get-Item $exe).VersionInfo.ProductVersion)" | Add-Content "$out\$tag.meta.txt"
if ($Fresh) {
  $id = Get-Content "$out\$tag.jsonl" -Encoding Unicode | Select-String -Pattern '"session_id":"([^"]+)"' | Select-Object -First 1 | ForEach-Object { $_.Matches[0].Groups[1].Value }
  if ($id) { Set-Content "$out\$P.session.txt" $id }
}
