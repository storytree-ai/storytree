# Prints the machine state that the retest resets and checks. Read-only.
"date: $(Get-Date -Format o)"
"--- commands on a fresh PATH"
$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
foreach ($c in 'git','node','gh','claude','codex','storytree') { $x = Get-Command $c -EA SilentlyContinue; "{0,-10} {1}" -f $c, $(if ($x) { $x.Source } else { '(none)' }) }
"--- user PATH"
[Environment]::GetEnvironmentVariable('Path','User') -split ';'
"--- storytree install"
$exe = "$env:LOCALAPPDATA\Programs\storytree-0.3\storytree-0.3.exe"
if (Test-Path $exe) { "installed: " + (Get-Item $exe).VersionInfo.ProductVersion } else { 'installed: no' }
"home ~\.storytree\0.3: " + (Test-Path "$HOME\.storytree\0.3")
"updater cache: " + (Test-Path "$env:LOCALAPPDATA\@storytreedesktop-updater")
"~\.codex: " + (Test-Path "$HOME\.codex")
"--- processes"
Get-Process | Where-Object { $_.ProcessName -match 'storytree|postgres|node|claude|codex' } | Select-Object Id, ProcessName, SessionId | Format-Table -AutoSize | Out-String -Width 200
"--- Claude Code settings.json (storytree lines)"
$s = "$HOME\.claude\settings.json"
if (Test-Path $s) { Select-String -LiteralPath $s -Pattern 'storytree' | ForEach-Object { $_.Line.Trim() } } else { '(no settings.json)' }
"--- claude.json mcpServers keys"
$cj = "$HOME\.claude.json"
if (Test-Path $cj) { $j = Get-Content -Raw $cj | ConvertFrom-Json; if ($j.mcpServers) { $j.mcpServers.PSObject.Properties.Name } else { '(none)' } }
"--- home folders"
Get-ChildItem -Force $HOME -Directory | Select-Object -ExpandProperty Name
"--- scheduled tasks named st-*"
schtasks /query /fo csv | ConvertFrom-Csv | Where-Object { $_.TaskName -like '\st-*' } | Select-Object -ExpandProperty TaskName
