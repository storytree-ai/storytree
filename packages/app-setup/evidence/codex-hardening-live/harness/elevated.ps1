# Over SSH, which on this laptop is an elevated (administrator) login: what storytree says there.
param([string]$Label)
$env:CODEX_HOME = "$HOME\st-codexharden\home-$Label"
Set-Location -LiteralPath "$HOME\CH Live $Label"
"--- integrity level: $((whoami /groups /fo csv | Select-String 'Mandatory Level') -replace '^.*Label\\([^,]*)\".*$','$1')"
"--- storytree setup connect --codex (elevated):"
storytree setup connect --codex 2>&1 | Out-String -Width 300
"--- a Codex session started here, asked to run the setup check:"
$null | codex exec --skip-git-repo-check --approve-for-me "Call storytree's check_setup once and report its full answer word for word. Do not change any file or run any other command." 2>&1 | Out-String -Width 300
