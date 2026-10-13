$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
$env:NEXT_TELEMETRY_DISABLED = '1'
$v = "$HOME\st-whole\viewer-for-reddit"
$w = "$HOME\st-whole\reddit-stats\packages\web"
Set-Location $v
Copy-Item -Force "$w\.env.local" "$v\.env.local"
$t = Get-Date
cmd /c "npx next build > ..\viewer-build.log 2>&1"
"viewer build exit $LASTEXITCODE seconds $([int]((Get-Date)-$t).TotalSeconds)"
Remove-Item -Force "$v\.env.local"
git status --short
"public files: $((Get-ChildItem -Recurse -File "$w\public" | Measure-Object).Count)"
"app files: $((Get-ChildItem -Recurse -File "$w\app" | Measure-Object).Count)"
Get-ChildItem -File $w | Select-Object -ExpandProperty Name
