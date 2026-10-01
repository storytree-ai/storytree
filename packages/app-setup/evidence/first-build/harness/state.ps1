# Prints everything storytree can add to this machine, and the user's own files beside it. Read-only.
# The user's project folders to watch are listed one per line in projects.txt beside this script.
$list = Join-Path $PSScriptRoot 'projects.txt'
$Projects = if (Test-Path $list) { @(Get-Content $list | Where-Object { $_ }) } else { @() }
"date: $(Get-Date -Format o)"
"--- commands on a fresh PATH"
$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
foreach ($c in 'claude','codex','storytree') { $x = Get-Command $c -EA SilentlyContinue; "{0,-10} {1}" -f $c, $(if ($x) { $x.Source } else { '(none)' }) }
"--- user PATH entries naming storytree"
[Environment]::GetEnvironmentVariable('Path','User') -split ';' | Where-Object { $_ -match 'storytree' }
"--- storytree install"
$exe = "$env:LOCALAPPDATA\Programs\storytree-0.3\storytree-0.3.exe"
if (Test-Path $exe) { "installed: " + (Get-Item $exe).VersionInfo.ProductVersion } else { 'installed: no' }
"install folder: " + (Test-Path "$env:LOCALAPPDATA\Programs\storytree-0.3")
"Apps & features entry: " + @(Get-ItemProperty HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\* -EA SilentlyContinue | Where-Object DisplayName -like 'storytree*' | ForEach-Object { "$($_.DisplayName)" }).Count
"start menu shortcut: " + (Test-Path "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\storytree-0.3.lnk")
"desktop shortcut: " + (Test-Path "$HOME\Desktop\storytree-0.3.lnk")
"--- storytree home"
"~\.storytree: " + (Test-Path "$HOME\.storytree")
if (Test-Path "$HOME\.storytree\0.3") { Get-ChildItem -Force "$HOME\.storytree\0.3" | ForEach-Object { "  $($_.Name)" } } else { "~\.storytree\0.3: absent" }
if (Test-Path "$HOME\.storytree") { Get-ChildItem -Force "$HOME\.storytree" | Where-Object Name -ne '0.3' | ForEach-Object { "  other in ~\.storytree: $($_.Name)" } }
"updater cache: " + (Test-Path "$env:LOCALAPPDATA\@storytreedesktop-updater")
"--- processes"
Get-Process | Where-Object { $_.ProcessName -match 'storytree|postgres' -or ($_.Path -and $_.Path -like '*storytree*') } | Select-Object Id, ProcessName, SessionId | Format-Table -AutoSize | Out-String -Width 200
"--- Claude Code"
$cj = "$HOME\.claude.json"
if (Test-Path $cj) { $j = Get-Content -Raw $cj | ConvertFrom-Json; "claude.json mcpServers: " + $(if ($j.mcpServers) { ($j.mcpServers.PSObject.Properties.Name -join ', ') } else { '(none)' }) }
$s = "$HOME\.claude\settings.json"
if (Test-Path $s) { "settings.json lines naming storytree: " + @(Select-String -LiteralPath $s -Pattern 'storytree').Count; "settings.json keys: " + ((Get-Content -Raw $s | ConvertFrom-Json).PSObject.Properties.Name -join ', ') } else { '(no settings.json)' }
"--- Codex"
"~\.codex: " + (Test-Path "$HOME\.codex")
$ct = "$HOME\.codex\config.toml"
if (Test-Path $ct) { "config.toml lines naming storytree: " + @(Select-String -LiteralPath $ct -Pattern 'storytree').Count } else { '(no config.toml)' }
"hooks.json: " + (Test-Path "$HOME\.codex\hooks.json")
$ag = "$HOME\.codex\AGENTS.md"
if (Test-Path $ag) { "AGENTS.md storytree section: " + [bool](Select-String -LiteralPath $ag -Pattern 'storytree: begin' -Quiet) } else { 'AGENTS.md: absent' }
"--- project folders"
foreach ($p in $Projects) { if (Test-Path -LiteralPath $p) { "$p :"; Get-ChildItem -Force -LiteralPath $p | ForEach-Object { "  $($_.Name)" } } else { "$p : absent" } }
"--- scheduled tasks named st-*"
schtasks /query /fo csv | ConvertFrom-Csv | Where-Object { $_.TaskName -like '\st-*' } | Select-Object -ExpandProperty TaskName
