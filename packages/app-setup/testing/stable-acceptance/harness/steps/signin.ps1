# As the fresh user: whether its Claude Code is signed in with the run's token, before the build is installed. A
# signed-out user's turns measure the sign-in, not the build (friction_58e4eda75992), so run.sh stops on a no. Only a
# call to the model proves the token works: `claude auth status` says signed in for any token it is given.
$env:CLAUDE_CODE_OAUTH_TOKEN = (Get-Content -Raw "$PSScriptRoot\claude-token.txt").Trim()
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
$said = (cmd /c "echo Reply with the single word READY.| claude -p --model haiku --max-turns 1 2>&1") -join ' '
$code = $LASTEXITCODE
if ($code -eq 0 -and $said -match 'READY') { 'signed in: yes' } else { "signed in: no (exit ${code}: $($said.Trim()))" }
