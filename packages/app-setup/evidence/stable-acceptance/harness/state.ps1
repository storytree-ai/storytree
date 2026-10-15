# What a run must leave as it found it on the laptop, one line per item, printed over SSH before and after the run
# and compared. The lines above st-users are the acceptance-run harness's (packages/app-setup/evidence/acceptance-run/
# harness/state.ps1: the owner's ~\.codex, installed hooks and command, PATH, app); the rest are this run's own.
$ErrorActionPreference = 'SilentlyContinue'
$codex = Get-ChildItem -Recurse -File -Force "$HOME\.codex" | Where-Object { $_.FullName -notmatch '\\(sessions|log|logs|\.tmp|tmp|cache)\\' -and $_.Name -notmatch '\.(log|sqlite|sqlite-wal|sqlite-shm)$' } | Sort-Object FullName | ForEach-Object { (Get-FileHash $_.FullName).Hash + ' ' + $_.FullName.Substring($HOME.Length) }
"codex-config: " + (Get-FileHash "$HOME\.codex\config.toml").Hash
"codex-hooks: " + (Get-FileHash "$HOME\.codex\hooks.json").Hash
"codex-agents: " + (Get-FileHash "$HOME\.codex\AGENTS.md").Hash
"codex-tree: " + ((($codex -join "`n") | ForEach-Object { [System.BitConverter]::ToString((New-Object Security.Cryptography.SHA256Managed).ComputeHash([Text.Encoding]::UTF8.GetBytes($_))) }) -replace '-','').Substring(0,16) + " ($($codex.Count) files)"
"claude-settings-storytree: " + ((Select-String -Path "$HOME\.claude\settings.json" -Pattern 'storytree' | ForEach-Object { $_.Line.Trim() }) -join ' | ')
"claude-mcp: " + ((Select-String -Path "$HOME\.claude.json" -Pattern 'storytree-mcp' | ForEach-Object { $_.Line.Trim() } | Sort-Object -Unique) -join ' | ')
"command: " + (powershell -NoProfile -Command '(Get-Command storytree -All).Source' | Out-String).Trim()
"command-file: " + (Get-FileHash "$HOME\.storytree\0.3\bin\storytree.cmd").Hash
"command-body: " + ((Get-Content "$HOME\.storytree\0.3\bin\storytree.cmd") -join ' / ')
"user-path: " + [Environment]::GetEnvironmentVariable('Path','User')
"app: " + (Get-Item "$env:LOCALAPPDATA\Programs\storytree-0.3\storytree-0.3.exe").VersionInfo.ProductVersion
"tasks: " + ((schtasks /query /fo csv | ConvertFrom-Csv | Where-Object { $_.TaskName -match 'st-' } | ForEach-Object TaskName) -join ',')
"processes: " + ((Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'st-accept|st-codexharden|codex exec|claude -p' -and $_.ProcessId -ne $PID } | ForEach-Object { "$($_.ProcessId) $($_.Name)" }) -join ',')
"home-trials: " + ((Get-ChildItem -Force -Name $HOME | Where-Object { $_ -match '^(st-accept|st-a2|CH First|CH Plain|st-codexharden)' }) -join ',')
"projects: " + ((& storytree project list 2>&1 | Out-String).Trim() -replace "`r?`n", ' / ')
"st-users: " + ((Get-LocalUser | Where-Object Name -like 'st-*' | ForEach-Object Name) -join ',')
"st-profiles: " + ((Get-CimInstance Win32_UserProfile | Where-Object LocalPath -like 'C:\Users\st-*' | ForEach-Object { "$($_.LocalPath) loaded=$($_.Loaded)" }) -join ',')
"st-tasks: " + ((Get-ScheduledTask -TaskName 'st-acc-*' -ErrorAction SilentlyContinue | ForEach-Object TaskName) -join ',')
"st-run-folders: " + ((Get-ChildItem -Name "$env:ProgramData\st-acceptance" -ErrorAction SilentlyContinue) -join ',')
"batch-logon: " + $(secedit /export /cfg "$env:TEMP\st-sec.inf" /areas USER_RIGHTS | Out-Null; (Select-String -Path "$env:TEMP\st-sec.inf" -Pattern '^SeBatchLogonRight').Line; Remove-Item "$env:TEMP\st-sec.inf")
