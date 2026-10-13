$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
$env:NEXT_TELEMETRY_DISABLED = '1'
Set-Location "$HOME\st-whole\reddit-stats\packages\web"
$t = Get-Date
cmd /c "npx next build > build.log 2>&1"
"build exit $LASTEXITCODE seconds $([int]((Get-Date)-$t).TotalSeconds)"
