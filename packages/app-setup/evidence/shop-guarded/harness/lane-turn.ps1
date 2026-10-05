# One user turn of one lane of the parallel shop build, for the laptop's Claude Code, run in the desktop session.
# Usage: lane-turn.ps1 -Turn <name> [-Resume <session id>]. Reads prompts\<name>.txt. Without -Resume it starts a
# fresh session; with it, it continues that session (several lanes run at once, so --continue would be ambiguous).
# Every lane starts in the project's main folder; the agent makes its own storytree workspace from there.
# Records the app version before and after, and the Claude Code session id (from the stream's init line).
param([string]$Turn, [string]$Resume = '')
$d = "$HOME\st-guard"
$out = "$d\runs"
$folder = "$HOME\shop3"
New-Item -ItemType Directory -Force $out, $folder | Out-Null
Set-Location -LiteralPath $folder
$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
$OutputEncoding = New-Object System.Text.UTF8Encoding $false
$exe = "$env:LOCALAPPDATA\Programs\storytree-0.3\storytree-0.3.exe"
$version = { if (Test-Path $exe) { (Get-Item $exe).VersionInfo.ProductVersion } else { 'none' } }
$prompt = Get-Content -Raw "$d\prompts\$Turn.txt"
$t = Get-Date
"start $(Get-Date -Format o) app $(& $version) resume '$Resume'" | Set-Content "$out\$Turn.meta.txt"
$more = if ($Resume) { @('--resume', $Resume) } else { @() }
$prompt | claude -p @more --permission-mode bypassPermissions --output-format stream-json --verbose > "$out\$Turn.jsonl" 2>&1
$code = $LASTEXITCODE
$session = (Select-String -LiteralPath "$out\$Turn.jsonl" -Pattern '"session_id":"([^"]+)"' | Select-Object -First 1).Matches.Groups[1].Value
"exit $code seconds $([int]((Get-Date) - $t).TotalSeconds) end $(Get-Date -Format o) app $(& $version) session $session" | Add-Content "$out\$Turn.meta.txt"
