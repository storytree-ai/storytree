# Take out exactly the files place-arm.ps1 added to the installed tools.
$manifest = "$HOME\st-second\added.txt"
$files = @(Get-Content $manifest)
foreach ($file in $files) { Remove-Item -Force $file -ErrorAction SilentlyContinue }
Remove-Item -Force $manifest
"removed $($files.Count) files; still there: $(@($files | Where-Object { Test-Path $_ }).Count)"
