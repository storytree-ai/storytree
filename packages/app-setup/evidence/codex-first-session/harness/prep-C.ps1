param([string]$Label)
& "$HOME\st-codexharden\prep.ps1" $Label | Out-Null
Copy-Item "$HOME\st-codexharden\agents-C.md" "$HOME\st-codexharden\home-$Label\AGENTS.md"
"prepared $Label with AGENTS.md"
