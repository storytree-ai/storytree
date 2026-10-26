# As the fresh user: Claude Code the way its site installs it, and its folder on the user's PATH.
$ProgressPreference = 'SilentlyContinue'
New-Item -ItemType Directory -Force "$PSScriptRoot\ev\shots" | Out-Null
"user: $(whoami); profile: $env:USERPROFILE"
Invoke-RestMethod https://claude.ai/install.ps1 | Invoke-Expression
$bin = "$env:USERPROFILE\.local\bin"
$path = [Environment]::GetEnvironmentVariable('Path', 'User')
if (($path -split ';') -notcontains $bin) { [Environment]::SetEnvironmentVariable('Path', $(if ($path) { "$path;$bin" } else { $bin }), 'User') }
"claude: $(& "$bin\claude.exe" --version)"
# Node LTS too, as a developer's laptop has it, from nodejs.org's own zip into the user's profile: without it the
# test command the user is told (npm test) cannot run, and the run would measure the laptop, not the build.
# The parentheses matter: Windows PowerShell 5.1 passes a JSON array down the pipe as one object.
$lts = ((Invoke-RestMethod https://nodejs.org/dist/index.json) | Where-Object { $_.lts } | Select-Object -First 1).version
Invoke-WebRequest "https://nodejs.org/dist/$lts/node-$lts-win-x64.zip" -OutFile "$env:TEMP\node.zip"
Expand-Archive "$env:TEMP\node.zip" "$env:LOCALAPPDATA\Programs" -Force
Remove-Item "$env:TEMP\node.zip"
$node = "$env:LOCALAPPDATA\Programs\node-$lts-win-x64"
$path = [Environment]::GetEnvironmentVariable('Path', 'User')
if (($path -split ';') -notcontains $node) { [Environment]::SetEnvironmentVariable('Path', "$path;$node", 'User') }
"node: $(& "$node\node.exe" --version)"
