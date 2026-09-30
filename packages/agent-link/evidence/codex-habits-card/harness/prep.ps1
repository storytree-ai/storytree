# Over SSH: one trial's fresh, signed-in CODEX_HOME (no hook trust) and fresh project folder, connected as
# a first user's are, with storytree's tool server then pointed at this trial's arm (A: main as it was,
# B: with the change), both built from one checkout. The owner's ~\.codex is only read. Usage: prep.ps1 <label> <A|B>
param([string]$Label, [string]$Arm)
$ErrorActionPreference = 'Stop'
$root = "$HOME\st-habits"
$ch = "$root\home-$Label"
$folder = "$HOME\HB Trial $Label"
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
$env:CODEX_HOME = $ch
Push-Location -LiteralPath $folder
storytree doctor --set-up "hb-$($Label.ToLower())" 2>&1 | Select-String 'project' | Out-String
storytree setup connect --codex 2>&1 | Select-Object -First 1 | Out-String
Pop-Location
$installed = "$env:LOCALAPPDATA\Programs\storytree-0.3\resources\agent-tools\storytree-mcp.mjs"
$arm = "$env:LOCALAPPDATA\Programs\storytree-0.3\resources\agent-tools\storytree-mcp-arm$Arm.mjs"
$config = Get-Content -Raw "$ch\config.toml"
if (-not $config.Contains($installed.Replace('\', '\\'))) { throw "no installed tool server in $ch\config.toml" }
Set-Content -Encoding utf8 "$ch\config.toml" -Value $config.Replace($installed.Replace('\', '\\'), $arm.Replace('\', '\\'))
"trial $Label, arm $($Arm): tool server $((Select-String -Path "$ch\config.toml" -Pattern 'storytree-mcp').Line.Trim())"
"hook trust entries: $(@(Select-String -Path "$ch\config.toml" -Pattern 'trusted_hash').Count); AGENTS.md: $(Test-Path "$ch\AGENTS.md")"
