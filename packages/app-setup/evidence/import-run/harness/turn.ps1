# One user turn of Claude Code in the trial project, run in the desktop session under an update hold.
# Usage: turn.ps1 <n> [-Fresh]. Reads prompts\turn-<n>.txt; turn 1 (or -Fresh) starts a session, later turns continue it.
param([int]$N, [switch]$Fresh)
$d = "$HOME\st-import"
$folder = "$d\reddit-plus"
$out = "$d\runs"
New-Item -ItemType Directory -Force $out, $folder | Out-Null
Set-Location -LiteralPath $folder
$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
$OutputEncoding = New-Object System.Text.UTF8Encoding $false
$prompt = Get-Content -Raw "$d\prompts\turn-$N.txt"
$exe = "$env:LOCALAPPDATA\Programs\storytree-0.3\storytree-0.3.exe"
$t = Get-Date
"start $(Get-Date -Format o) app $((Get-Item $exe).VersionInfo.ProductVersion)" | Set-Content "$out\turn-$N.meta.txt"
$more = if ($N -gt 1 -and -not $Fresh) { @('--continue') } else { @() }
$ErrorActionPreference = 'Continue'
$prompt | claude -p @more --permission-mode bypassPermissions --output-format stream-json --verbose > "$out\turn-$N.jsonl" 2>&1
$code = $LASTEXITCODE
"exit $code seconds $([int]((Get-Date) - $t).TotalSeconds) end $(Get-Date -Format o) app $((Get-Item $exe).VersionInfo.ProductVersion)" | Add-Content "$out\turn-$N.meta.txt"
