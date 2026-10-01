# The first-run journey with Codex, run in the owner's desktop session (Codex cannot run commands from an
# elevated SSH login; process_81a7122f6849 step 9), started by ../acceptance-run/harness/run-task.ps1 after
# prep.ps1 made the trial's fresh CODEX_HOME. Two fresh folders, and in each a new Codex session asked, as a
# first user would ask, to set storytree up there. Then the installed storytree command, from a fresh
# terminal in each folder, says what it sees. Writes every raw output to $Out; observe.mjs turns them into
# checks. Usage: journey.ps1 <outDir> <stamp>
param([string]$Out, [string]$Stamp)
$ErrorActionPreference = 'Continue'
New-Item -ItemType Directory -Force $Out | Out-Null
$env:CODEX_HOME = "$HOME\st-accept-run\codex-home-$Stamp"
$exe = "$env:LOCALAPPDATA\Programs\storytree-0.3\storytree-0.3.exe"
(Get-Item $exe).VersionInfo.ProductVersion | Set-Content "$Out\app-version-before.txt"
(Get-Date).ToUniversalTime().ToString('o') | Set-Content "$Out\started.txt"
foreach ($side in 'a', 'b') {
  $name = "st-accept-$Stamp-$side"
  $folder = "$HOME\$name"
  New-Item -ItemType Directory -Force $folder | Out-Null
  Set-Location $folder
  powershell -NoProfile -Command 'storytree doctor' *> "$Out\doctor-$side-before.txt"
  $ask = "Hi! I'd like to build a small to-do list web page in this folder, and I want storytree to keep its plan. Please set storytree up for this folder, as the project $name, and tell me in one line what you did."
  $null | codex exec --skip-git-repo-check --approve-for-me $ask *> "$Out\codex-$side.txt"
  "$LASTEXITCODE" | Set-Content "$Out\codex-$side-exit.txt"
  # PowerShell 5.1 strips quotes passed to a native program, so the exit code goes to its own file.
  powershell -NoProfile -Command 'storytree doctor' *> "$Out\doctor-$side-after.txt"
  "$LASTEXITCODE" | Set-Content "$Out\doctor-$side-exit.txt"
  powershell -NoProfile -Command '(Get-Command storytree).Source' *> "$Out\command-$side.txt"
}
Set-Location $HOME
# Where Codex starts storytree's tool server from, as its registration in the trial's home names it.
Select-String -Path "$env:CODEX_HOME\config.toml" -Pattern 'storytree-mcp\.mjs' | ForEach-Object { $_.Line.Trim() } | Set-Content "$Out\mcp-registration.txt"
# How many hooks the trial's Codex home trusts: a first user has trusted none.
"$((Select-String -Path "$env:CODEX_HOME\config.toml" -Pattern 'trusted_hash' | Measure-Object).Count)" | Set-Content "$Out\hook-trust.txt"
(Get-Item $exe).VersionInfo.ProductVersion | Set-Content "$Out\app-version-after.txt"
'done' | Set-Content "$Out\done.txt"
