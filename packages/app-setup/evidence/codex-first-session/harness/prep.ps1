# Prepares one untrusted first-Codex-session trial on the laptop, over SSH (nothing here needs the desktop).
# A fresh CODEX_HOME (signed in by copying auth.json and the one-time sandbox setup, no hook trust) and a
# fresh project folder with a space in its name, set up as the installer would (ADR-0752 D1), then
# `storytree setup connect --codex` into that home. The owner's ~\.codex is only read, never written.
param([string]$Label)
$ErrorActionPreference = 'Stop'
$root = "$HOME\st-codexharden"
$ch = "$root\home-$Label"
$folder = "$HOME\CH First $Label"
if (Test-Path $ch) { Remove-Item -Recurse -Force $ch }
if (Test-Path $folder) { Remove-Item -Recurse -Force $folder }
New-Item -ItemType Directory -Force $ch, $folder | Out-Null
foreach ($f in 'auth.json', 'cap_sid', '.sandbox_migration') { Copy-Item "$HOME\.codex\$f" $ch }
foreach ($d in '.sandbox', '.sandbox-bin', '.sandbox-secrets') { Copy-Item -Recurse "$HOME\.codex\$d" $ch }
$key = $folder.ToLower()
Set-Content -Encoding utf8 "$ch\config.toml" -Value @"
[projects.'$key']
trust_level = "trusted"

[windows]
sandbox = "elevated"
"@
$env:CODEX_HOME = $ch
Push-Location $folder
storytree doctor --set-up "ch-first-$($Label.ToLower())" 2>&1 | Out-String
storytree setup connect --codex 2>&1 | Out-String
Pop-Location
"--- hook trust entries in the fresh home (expect none):"
(Select-String -Path "$ch\config.toml" -Pattern 'trusted_hash' -ErrorAction SilentlyContinue | Measure-Object).Count
