# As the fresh user: Claude Code the way its site installs it, and its folder on the user's PATH.
$ProgressPreference = 'SilentlyContinue'
New-Item -ItemType Directory -Force "$PSScriptRoot\ev\shots" | Out-Null
"user: $(whoami); profile: $env:USERPROFILE"
Invoke-RestMethod https://claude.ai/install.ps1 | Invoke-Expression
$bin = "$env:USERPROFILE\.local\bin"
$path = [Environment]::GetEnvironmentVariable('Path', 'User')
if (($path -split ';') -notcontains $bin) { [Environment]::SetEnvironmentVariable('Path', $(if ($path) { "$path;$bin" } else { $bin }), 'User') }
"claude: $(& "$bin\claude.exe" --version)"
