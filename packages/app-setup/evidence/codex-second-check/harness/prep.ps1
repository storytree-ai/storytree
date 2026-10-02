# Over SSH: one trial's fresh, signed-in CODEX_HOME and a fresh EMPTY folder (not set up: the session's
# user asks for that), with storytree connected to that home as the installer does (`storytree setup
# connect --codex`, run from the trial's root so no project is touched). Optionally points the tool server at
# an arm placed beside the installed tools (see ..\..\..\..\agent-link\evidence\codex-habits-card\harness\place-arms.ps1).
# The owner's ~\.codex is only read. Usage: prep.ps1 <label> [arm]
param([string]$Label, [string]$Arm = '')
$ErrorActionPreference = 'Stop'
$root = "$HOME\st-second"
$ch = "$root\home-$Label"
$folder = "$HOME\SC Trial $Label"
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
Push-Location -LiteralPath $root
storytree setup connect --codex 2>&1 | Select-Object -First 3 | Out-String
Pop-Location
if ($Arm -ne '') {
  $installed = "$env:LOCALAPPDATA\Programs\storytree-0.3\resources\agent-tools\storytree-mcp.mjs"
  $armFile = "$env:LOCALAPPDATA\Programs\storytree-0.3\resources\agent-tools\storytree-mcp-arm$Arm.mjs"
  $config = Get-Content -Raw "$ch\config.toml"
  if (-not $config.Contains($installed.Replace('\', '\\'))) { throw "no installed tool server in $ch\config.toml" }
  Set-Content -Encoding utf8 "$ch\config.toml" -Value $config.Replace($installed.Replace('\', '\\'), $armFile.Replace('\', '\\'))
}
"trial $Label, arm '$Arm': $((Select-String -Path "$ch\config.toml" -Pattern 'storytree-mcp').Line.Trim())"
"folder empty: $(@(Get-ChildItem -Force -LiteralPath $folder).Count -eq 0); AGENTS.md: $(Test-Path "$ch\AGENTS.md"); hooks.json: $(Test-Path "$ch\hooks.json")"
