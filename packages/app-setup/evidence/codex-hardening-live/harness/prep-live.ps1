# Over SSH: a fresh, signed-in CODEX_HOME with no hook trust and nothing of storytree's, and a fresh empty
# folder with a space in its name. The owner's ~\.codex is only read. Usage: prep-live.ps1 <label>
param([string]$Label)
$ErrorActionPreference = 'Stop'
$ch = "$HOME\st-codexharden\home-$Label"
$folder = "$HOME\CH Live $Label"
foreach ($p in $ch, $folder) { if (Test-Path $p) { Remove-Item -Recurse -Force $p } }
New-Item -ItemType Directory -Force $ch, $folder | Out-Null
foreach ($f in 'auth.json', 'cap_sid', '.sandbox_migration') { Copy-Item "$HOME\.codex\$f" $ch }
foreach ($d in '.sandbox', '.sandbox-bin', '.sandbox-secrets') { Copy-Item -Recurse "$HOME\.codex\$d" $ch }
Set-Content -Encoding utf8 "$ch\config.toml" -Value @"
[projects.'$($folder.ToLower())']
trust_level = "trusted"

[windows]
sandbox = "elevated"
"@
"prepared $ch and $folder; files in home: $((Get-ChildItem -Force $ch | Measure-Object).Count); AGENTS.md: $(Test-Path "$ch\AGENTS.md"); hooks.json: $(Test-Path "$ch\hooks.json")"
