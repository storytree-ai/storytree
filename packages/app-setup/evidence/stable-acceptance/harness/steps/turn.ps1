# As the fresh user: one turn of the model-driven user, a headless Claude Code session in the project folder given
# prompt-@N@.txt. Its approvals are bypassed: the run has no person to click them, and a turn that still needed one
# shows as a refusal in its transcript.
$ev = "$PSScriptRoot\ev"
$project = Join-Path $env:USERPROFILE 'tipjar'
$env:CLAUDE_CODE_OAUTH_TOKEN = (Get-Content -Raw "$PSScriptRoot\claude-token.txt").Trim()
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
$app = (Get-Item "$env:LOCALAPPDATA\Programs\storytree-0.3\storytree-0.3.exe").VersionInfo.ProductVersion
"start $(Get-Date -Format o) app $app" | Set-Content "$ev\turn-@N@.meta.txt"
Set-Location -LiteralPath $project
$t = Get-Date
cmd /c "claude -p @MORE@ --permission-mode bypassPermissions --output-format stream-json --verbose < `"$PSScriptRoot\prompt-@N@.txt`" > `"$ev\turn-@N@.jsonl`" 2>&1"
$code = $LASTEXITCODE
$app = (Get-Item "$env:LOCALAPPDATA\Programs\storytree-0.3\storytree-0.3.exe").VersionInfo.ProductVersion
"exit $code seconds $([int]((Get-Date) - $t).TotalSeconds) end $(Get-Date -Format o) app $app" | Add-Content "$ev\turn-@N@.meta.txt"
Get-Content "$ev\turn-@N@.meta.txt"
