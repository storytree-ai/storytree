# As the fresh user: the run's own look at what the user built: its tests run again by the command the user named,
# (test-command.txt) and what storytree's library holds for the project. The judge reads both; nothing here grades.
$ev = "$PSScriptRoot\ev"
$project = Join-Path $env:USERPROFILE 'tipjar'
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
$tools = "$env:LOCALAPPDATA\Programs\storytree-0.3\resources\agent-tools"
Set-Location -LiteralPath $project
$t = Get-Date
$command = (Get-Content -Raw -Encoding UTF8 "$PSScriptRoot\test-command.txt").Trim()
"> $command" | Set-Content "$ev\tests.txt"
cmd /c "$command >> `"$ev\tests.txt`" 2>&1"
"exit $LASTEXITCODE seconds $([int]((Get-Date) - $t).TotalSeconds)" | Add-Content "$ev\tests.txt"
# Out-File as UTF-8: Windows PowerShell 5.1's > writes UTF-16, which the judge reads as spaced-out letters.
& "$tools\node.exe" "$tools\storytree.mjs" tree 2>&1 | Out-File -Encoding utf8 "$ev\library-tree.txt"
& "$tools\node.exe" "$tools\storytree.mjs" arc list 2>&1 | Out-File -Encoding utf8 "$ev\library-arcs.txt"
Get-ChildItem -Recurse -File -Force $project | Where-Object { $_.FullName -notmatch '\\(\.git|node_modules)\\' } | ForEach-Object { "$($_.Length) $($_.FullName.Substring($project.Length))" } | Out-File -Encoding utf8 "$ev\project-files.txt"
"app: $((Get-Item "$env:LOCALAPPDATA\Programs\storytree-0.3\storytree-0.3.exe").VersionInfo.ProductVersion)"
Get-Content "$ev\tests.txt" -Tail 15
