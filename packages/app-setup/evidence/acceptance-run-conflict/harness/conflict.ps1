# App setup 1.6's second clause, run in the owner's desktop session (the installer's finish step opens the
# app, which only the desktop session can hand off to), started by ../../acceptance-run/harness/run-task.ps1
# with this script's name. A dummy `storytree.cmd` of the user's own is planted in a folder that is on their
# PATH ahead of storytree's (~\.local\bin), then the installed app's own installer step and setup check run as
# a first user's installation runs them. Then a fresh PowerShell says which storytree it runs. The dummy is
# ALWAYS removed at the end. Writes every raw output to $Out; observe.mjs turns them into checks.
# With it gone, a fresh PowerShell finds storytree's own command again (1.6's first clause).
# Usage: conflict.ps1 <outDir> <stamp>
param([string]$Out, [string]$Stamp)
$ErrorActionPreference = 'Continue'
New-Item -ItemType Directory -Force $Out | Out-Null
$install = "$env:LOCALAPPDATA\Programs\storytree-0.3"
$tools = "$install\resources\agent-tools"
$arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
$launcher = "$HOME\.storytree\0.3\bin\storytree.cmd"
$dummy = "$HOME\.local\bin\storytree.cmd"
(Get-Item "$install\storytree-0.3.exe").VersionInfo.ProductVersion | Set-Content "$Out\app-version-before.txt"
(Get-Date).ToUniversalTime().ToString('o') | Set-Content "$Out\started.txt"
if (Test-Path $dummy) { "a storytree.cmd was already in $HOME\.local\bin: not touched, run refused" | Set-Content "$Out\refused.txt"; exit 1 }
$madeFolder = -not (Test-Path "$HOME\.local\bin")
try {
  New-Item -ItemType Directory -Force "$HOME\.local\bin" | Out-Null
  Set-Content -Encoding ascii -LiteralPath $dummy -Value "@echo off`r`necho the user's own storytree command ($Stamp)"
  $dummy | Set-Content "$Out\dummy-path.txt"
  (Get-FileHash $dummy).Hash | Set-Content "$Out\dummy-before.txt"
  (Get-FileHash $launcher).Hash | Set-Content "$Out\launcher-before.txt"
  # The PATH a fresh terminal gets, as the installer's own process would see it.
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
  # The installer's finish step, exactly as install.ps1 runs it: its JSON report says what it did with the command.
  & "$tools\node.exe" "$tools\storytree-deliver.mjs" finish $install $arch > "$Out\finish.txt" 2> "$Out\finish-err.txt"
  "$LASTEXITCODE" | Set-Content "$Out\finish-exit.txt"
  # The setup check, run explicitly from the installation, as install.ps1 runs it when a conflict is reported.
  & "$tools\node.exe" "$tools\storytree.mjs" doctor *> "$Out\doctor.txt"
  # A fresh PowerShell: which storytree commands it finds, in order, and what `storytree` runs.
  powershell -NoProfile -Command '(Get-Command storytree -All).Source' *> "$Out\command-all.txt"
  powershell -NoProfile -Command 'storytree' *> "$Out\fresh-storytree.txt"
  (Get-FileHash $dummy).Hash | Set-Content "$Out\dummy-after.txt"
  (Get-FileHash $launcher).Hash | Set-Content "$Out\launcher-after.txt"
} finally {
  Remove-Item -Force -LiteralPath $dummy -ErrorAction SilentlyContinue
  if ($madeFolder) { Remove-Item -Force "$HOME\.local\bin" -ErrorAction SilentlyContinue }
  "$(Test-Path $dummy)" | Set-Content "$Out\dummy-left.txt"
}
# 1.6's first clause, with the user's command gone: a fresh PowerShell finds storytree's installed command
# and its doctor exits 0 (the exit code goes to its own file: PowerShell 5.1 strips quotes, process step 6).
powershell -NoProfile -Command '(Get-Command storytree).Source' *> "$Out\command-after.txt"
powershell -NoProfile -Command 'storytree doctor' *> "$Out\doctor-after.txt"
"$LASTEXITCODE" | Set-Content "$Out\doctor-after-exit.txt"
(Get-Item "$install\storytree-0.3.exe").VersionInfo.ProductVersion | Set-Content "$Out\app-version-after.txt"
'done' | Set-Content "$Out\done.txt"
