# The first-build journey, run in the owner's desktop session (../../acceptance-run/harness/run-task.ps1, through
# held-journey.ps1). Folder a: a new Claude Code session asked to set storytree up there; then a second new
# session asked to build a small to-do page with tests, and the same session continued for one more feature.
# Folder b, later: a new session asked to set storytree up there. While the build turns run, a watcher reads
# the plan with storytree's installed command every few seconds (`storytree tree`), since the command shows a
# contract's reported health as it stands, not each state it had. Every raw output goes to $Out; read.ps1 then
# reads the plan back over SSH and observe.mjs turns both into checks. Usage: journey.ps1 <outDir> <stamp>
# A stamp starting "dry" swaps every prompt for "Reply with just the word ok." to test the capture cheaply.
param([string]$Out, [string]$Stamp)
$ErrorActionPreference = 'Continue'
$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
$OutputEncoding = New-Object System.Text.UTF8Encoding $false
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
New-Item -ItemType Directory -Force $Out | Out-Null
$exe = "$env:LOCALAPPDATA\Programs\storytree-0.3\storytree-0.3.exe"
(Get-Item $exe).VersionInfo.ProductVersion | Set-Content "$Out\app-version-before.txt"
(Get-Date).ToUniversalTime().ToString('o') | Set-Content "$Out\started.txt"
$allowed = @('mcp__storytree', 'Edit', 'Write', 'Read', 'Glob', 'Grep', 'Bash', 'PowerShell')

function Doctor([string]$Name) {
  # PowerShell 5.1 strips quotes passed to a native program, so the exit code goes to its own file.
  powershell -NoProfile -Command 'storytree doctor' *> "$Out\doctor-$Name.txt"
  "$LASTEXITCODE" | Set-Content "$Out\doctor-$Name-exit.txt"
}

function Turn([int]$N, [string]$Folder, [string]$Project, [switch]$Continue) {
  Set-Location -LiteralPath $Folder
  $prompt = if ($Stamp -like 'dry*') { 'Reply with just the word ok.' } else { (Get-Content -Raw "$dir\prompts\turn-$N.txt").Replace('{project}', $Project) }
  [string[]]$more = if ($Continue) { @('--continue') } else { @() }
  (Get-Date).ToUniversalTime().ToString('o') | Set-Content "$Out\turn-$N-started.txt"
  $prompt | claude -p @more --allowedTools @allowed --output-format stream-json --verbose *> "$Out\turn-$N.jsonl"
  "$LASTEXITCODE" | Set-Content "$Out\turn-$N-exit.txt"
  (Get-Date).ToUniversalTime().ToString('o') | Set-Content "$Out\turn-$N-ended.txt"
}

$a = "st-accept-fb-$Stamp-a"; $b = "st-accept-fb-$Stamp-b"
$folderA = "$HOME\$a"; $folderB = "$HOME\$b"
New-Item -ItemType Directory -Force $folderA | Out-Null
Set-Location -LiteralPath $folderA
Doctor 'a-before'
Turn 1 $folderA $a
Doctor 'a-after'
powershell -NoProfile -Command '(Get-Command storytree).Source' *> "$Out\command-a.txt"

# The watcher: the plan as storytree's command shows it, stamped, until the build turns end.
$stop = "$Out\watch.stop"
$watch = Start-Job -ArgumentList $folderA, "$Out\watch.txt", $stop -ScriptBlock {
  param($folder, $file, $stop)
  $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
  Set-Location -LiteralPath $folder
  while (-not (Test-Path $stop)) {
    $tree = (& storytree tree 2>&1 | Out-String)
    Add-Content -LiteralPath $file -Encoding utf8 -Value ("@@ " + (Get-Date).ToUniversalTime().ToString('o') + "`n" + $tree)
    Start-Sleep -Seconds 3
  }
}
Turn 2 $folderA $a
Turn 3 $folderA $a -Continue
'stop' | Set-Content $stop
Wait-Job $watch -Timeout 60 | Out-Null
Remove-Job $watch -Force
Remove-Item $stop
Set-Location -LiteralPath $folderA
Doctor 'a-final'

New-Item -ItemType Directory -Force $folderB | Out-Null
Set-Location -LiteralPath $folderB
Doctor 'b-before'
Turn 4 $folderB $b
Doctor 'b-after'
powershell -NoProfile -Command '(Get-Command storytree).Source' *> "$Out\command-b.txt"

Set-Location $HOME
(Get-Item $exe).VersionInfo.ProductVersion | Set-Content "$Out\app-version-after.txt"
'done' | Set-Content "$Out\done.txt"
