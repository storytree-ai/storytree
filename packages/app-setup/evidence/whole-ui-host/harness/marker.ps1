$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
$env:NEXT_TELEMETRY_DISABLED = '1'
Set-Location "$HOME\st-whole\reddit-stats\packages\web"
$f = "app\(public)\about\page.tsx"
$orig = Get-Content -Raw -LiteralPath $f
Set-Content -NoNewline -LiteralPath $f -Value ($orig -replace "title: 'About',", "title: 'About (served by the storytree package)',")
cmd /c "npx next build > build-mark.log 2>&1"
"build exit $LASTEXITCODE"
$p = Start-Process -PassThru -WindowStyle Hidden cmd -ArgumentList '/c','npx next start -p 3125 > serve-mark.log 2>&1'
Start-Sleep 8
$r = Invoke-WebRequest -UseBasicParsing "http://localhost:3125/about"
"about title: $([regex]::Match($r.Content,'<title>(.*?)</title>').Groups[1].Value)"
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match '3125' } | ForEach-Object { Stop-Process -Force -Id $_.ProcessId -ErrorAction SilentlyContinue }
Set-Content -NoNewline -LiteralPath $f -Value $orig
Set-Location "$HOME\st-whole\viewer-for-reddit"; "viewer git status:"; git status --short; "end"
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'st-whole' -and $_.Name -eq 'node.exe' } | Measure-Object | ForEach-Object { "node processes left: $($_.Count)" }
