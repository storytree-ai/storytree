# Take out exactly the files place-arms.ps1 added to the installed tools.
$manifest = "$HOME\st-habits\added.txt"
$files = @(Get-Content $manifest)
foreach ($file in $files) { Remove-Item -Force $file -ErrorAction SilentlyContinue }
"removed $($files.Count) files; still there: $(@($files | Where-Object { Test-Path $_ }).Count)"
