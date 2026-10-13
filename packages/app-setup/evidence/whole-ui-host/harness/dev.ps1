$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
Set-Location "$HOME\st-whole\reddit-stats\packages\web"
$p = Start-Process -PassThru -WindowStyle Hidden cmd -ArgumentList '/c','npx next dev -p 3124 > dev.log 2>&1'
Start-Sleep 15
foreach ($u in '/','/about','/donate','/robots.txt','/home') {
  try { $r = Invoke-WebRequest -UseBasicParsing -MaximumRedirection 0 -ErrorAction Stop "http://localhost:3124$u"; "$u $($r.StatusCode) $($r.Content.Length) bytes title: $([regex]::Match($r.Content,'<title>(.*?)</title>').Groups[1].Value)" }
  catch { "$u $($_.Exception.Response.StatusCode.value__) $($_.Exception.Response.Headers['Location'])" }
}
$r = Invoke-WebRequest -UseBasicParsing "http://localhost:3124/about"; $r.Content | Out-File -Encoding utf8 about-dev.html
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'next dev -p 3124' -or $_.CommandLine -match 'next.dist' } | ForEach-Object { Stop-Process -Force -Id $_.ProcessId -ErrorAction SilentlyContinue }
Stop-Process -Force -Id $p.Id -ErrorAction SilentlyContinue
Get-Content dev.log
