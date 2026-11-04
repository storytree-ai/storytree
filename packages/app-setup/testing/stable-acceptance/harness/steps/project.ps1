# As the fresh user: ~\tipjar added as a project, the way the app's first-run guide offers it in a terminal (Add a
# project → In a terminal: storytree doctor --set-up <name>, in the folder). The guide's Add a project… button opens
# Windows' folder picker, which DevTools cannot reach.
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
Set-Location -LiteralPath (Join-Path $env:USERPROFILE 'tipjar') -ErrorAction Stop
storytree doctor --set-up tipjar 2>&1
"set-up exit: $LASTEXITCODE"
