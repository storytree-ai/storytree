# Prepares one Codex first-run trial over SSH (nothing here needs the desktop; process_81a7122f6849 step 10).
# A fresh CODEX_HOME, signed in by copying the sign-in and the one-time sandbox setup, with no hook trust and
# both trial folders trusted, then `storytree setup connect --codex` into it, as the installer's connect step
# does, saving its result for observe.mjs. The owner's ~\.codex is only read, never written. Usage: prep.ps1 <stamp>
param([string]$Stamp)
$ErrorActionPreference = 'Stop'
$dir = "$HOME\st-accept-run"
$ch = "$dir\codex-home-$Stamp"
New-Item -ItemType Directory -Force $ch | Out-Null
foreach ($f in 'auth.json', 'cap_sid', '.sandbox_migration') { Copy-Item "$HOME\.codex\$f" $ch }
foreach ($d in '.sandbox', '.sandbox-bin', '.sandbox-secrets') { Copy-Item -Recurse "$HOME\.codex\$d" $ch }
$trust = foreach ($side in 'a', 'b') { "[projects.'$("$HOME\st-accept-$Stamp-$side".ToLower())']`ntrust_level = `"trusted`"`n" }
Set-Content -Encoding utf8 "$ch\config.toml" -Value (($trust -join "`n") + "`n[windows]`nsandbox = `"elevated`"")
$env:CODEX_HOME = $ch
$out = "$dir\out-$Stamp"
New-Item -ItemType Directory -Force $out | Out-Null
# The installation result, from this elevated SSH login, and whether it was elevated (High Mandatory Level).
storytree setup connect --codex *> "$out\connect.txt"
"$((whoami /groups /fo csv | ConvertFrom-Csv | Where-Object SID -eq 'S-1-16-12288' | Measure-Object).Count -gt 0)" | Set-Content "$out\connect-elevated.txt"
Get-Content "$out\connect.txt"
"hook trust entries in the fresh home: " + (Select-String -Path "$ch\config.toml" -Pattern 'trusted_hash' -ErrorAction SilentlyContinue | Measure-Object).Count
