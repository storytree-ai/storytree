$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
$root = "$HOME\st-whole"
New-Item -ItemType Directory -Force $root | Out-Null
Set-Location $root
$t = Get-Date
git clone -q https://github.com/gregrickaby/viewer-for-reddit viewer-for-reddit 2>&1
Set-Location viewer-for-reddit
git -c advice.detachedHead=false checkout -q 7352a167222032ba374e338c1a76a4cc2421b1b9 2>&1
git log --oneline -1
"clone seconds $([int]((Get-Date)-$t).TotalSeconds)"
$t = Get-Date
npm ci --no-audit --no-fund 2>&1 | Select-Object -Last 3
"npm ci exit $LASTEXITCODE seconds $([int]((Get-Date)-$t).TotalSeconds)"
git status --short | Measure-Object | ForEach-Object { "dirty files: $($_.Count)" }
