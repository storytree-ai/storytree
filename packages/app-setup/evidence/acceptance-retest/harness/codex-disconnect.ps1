$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
"--- storytree setup disconnect codex"
& storytree setup disconnect codex 2>&1
"exit $LASTEXITCODE"
"--- codex mcp list"
& codex mcp list 2>&1
"--- ~\.codex\hooks.json present: $(Test-Path "$HOME\.codex\hooks.json")"
if (Test-Path "$HOME\.codex\hooks.json") { "storytree hook lines: $(@(Select-String -LiteralPath "$HOME\.codex\hooks.json" -Pattern 'storytree-hook.mjs').Count)" }
"--- claude mcp list"
& claude mcp list 2>&1 | Select-String storytree
"--- storytree command: $((Get-Command storytree -EA SilentlyContinue).Source)"
"--- storytree doctor"
& storytree doctor 2>&1
