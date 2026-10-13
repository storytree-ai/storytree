$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
$v = "$HOME\st-whole\viewer-for-reddit"
$w = "$HOME\st-whole\reddit-stats\packages\web"
New-Item -ItemType Directory -Force $w | Out-Null
Copy-Item -Force "$HOME\stw-web\*" $w
robocopy "$v\app" "$w\app" /E /XD actions /NFL /NDL /NJH /NJS | Out-Null
robocopy "$v\public" "$w\public" /E /NFL /NDL /NJH /NJS | Out-Null
Copy-Item -Force "$v\proxy.ts","$v\instrumentation.ts","$v\instrumentation-client.ts" $w
(Get-ChildItem -Recurse -File "$w" | Measure-Object).Count
