$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
"codex: $((Get-Command codex -EA SilentlyContinue).Source)"
& codex --version
"--- storytree setup connect --codex (1)"
& storytree setup connect --codex 2>&1
"exit $LASTEXITCODE"
"--- storytree setup connect --codex (2)"
& storytree setup connect --codex 2>&1
"exit $LASTEXITCODE"
"--- codex mcp list"
& codex mcp list 2>&1
"--- ~\.codex\hooks.json present: $(Test-Path "$HOME\.codex\hooks.json")"
if (Test-Path "$HOME\.codex\hooks.json") { "storytree hook lines: $(@(Select-String -LiteralPath "$HOME\.codex\hooks.json" -Pattern 'storytree-hook.mjs').Count)" }
"--- config.toml storytree tables: $(@(Select-String -LiteralPath "$HOME\.codex\config.toml" -Pattern '^\[mcp_servers\.storytree').Count)"
