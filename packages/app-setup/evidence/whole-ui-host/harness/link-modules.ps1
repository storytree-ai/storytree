$w = "$HOME\st-whole\reddit-stats\packages\web"
Copy-Item -Force "$HOME\stw-web\package.json" $w
Set-Location $w
Remove-Item -Force -ErrorAction SilentlyContinue package-lock.json
if (Test-Path node_modules) { cmd /c rmdir /s /q node_modules }
New-Item -ItemType Junction -Path node_modules -Target "$HOME\st-whole\viewer-for-reddit\node_modules" | Out-Null
Get-Item node_modules | Select-Object Name, LinkType, Target | Format-List | Out-String -Width 200
