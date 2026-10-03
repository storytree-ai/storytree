# One user turn of the shop build for the laptop's Claude Code, run in the desktop session.
# Usage: shop-turn.ps1 -N <n> [-Fresh]. Reads prompts\shop-<n>.txt; -Fresh starts a new session (each part
# does), otherwise the turn continues the folder's latest session (a follow-up turn in the same session).
# Records the app version before and after (a changed version voids the turn as proof; process_81a7122f6849).
param([string]$N, [switch]$Fresh)
$d = "$HOME\st-shop"
$out = "$d\runs"
$folder = "$HOME\shop"
New-Item -ItemType Directory -Force $out, $folder | Out-Null
Set-Location -LiteralPath $folder
$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
$OutputEncoding = New-Object System.Text.UTF8Encoding $false
$exe = "$env:LOCALAPPDATA\Programs\storytree-0.3\storytree-0.3.exe"
$version = { if (Test-Path $exe) { (Get-Item $exe).VersionInfo.ProductVersion } else { 'none' } }
$prompt = Get-Content -Raw "$d\prompts\shop-$N.txt"
$t = Get-Date
"start $(Get-Date -Format o) app $(& $version) fresh $Fresh" | Set-Content "$out\turn-$N.meta.txt"
$more = if ($Fresh) { @() } else { @('--continue') }
$prompt | claude -p @more --permission-mode bypassPermissions --output-format stream-json --verbose > "$out\turn-$N.jsonl" 2>&1
"exit $LASTEXITCODE seconds $([int]((Get-Date) - $t).TotalSeconds) end $(Get-Date -Format o) app $(& $version)" | Add-Content "$out\turn-$N.meta.txt"
