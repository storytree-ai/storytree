# As the fresh user: the stable one-liner with the run's version, answered as a first user answers it (1: Claude Code;
# a project folder), then the app restarted with a DevTools port so the run can see and use its screens.
$ev = "$PSScriptRoot\ev"
$project = Join-Path $env:USERPROFILE 'tipjar'
$answers = @'
$ProgressPreference = 'SilentlyContinue'
$env:STORYTREE_ACCEPTANCE_VERSION = '@VERSION@'
Set-Location -LiteralPath $HOME
$t = Get-Date
& ([scriptblock]::Create((Invoke-RestMethod '@INSTALLER@')))
1
@PROJECT@

"install exit: $LASTEXITCODE; seconds: $([int]((Get-Date) - $t).TotalSeconds)"
'@
Set-Content -LiteralPath "$PSScriptRoot\install.in.txt" -Value $answers.Replace('@PROJECT@', $project) -Encoding ascii
cmd /c "powershell -NoProfile -ExecutionPolicy Bypass -Command - < `"$PSScriptRoot\install.in.txt`" > `"$ev\install.transcript.txt`" 2>&1"
Get-Content -LiteralPath "$ev\install.transcript.txt"
