# The Windows update over live agent tools (increment_dcb59d18e37b, arc_fa72f1830b5d), run on a fresh GitHub Windows
# runner, x64 or arm64, by .github/workflows/windows-update-over-tools.yml. The previous release is installed by its own
# one-liner, Claude Code is connected to it, and (with -Session open) an agent session's storytree tools are started
# from that registration and left running: the MCP server mid-conversation and a hook still reading its input. Then the
# candidate's setup is run as the app's updater runs it (--updated --force-run, started as the app quits), and the run
# fails unless the setup finishes within the bound, the candidate's version is installed, the agents are re-pointed at
# its tools and those tools answer, and an open session's tools still answer afterwards. -Session closed repeats it
# with no session open. On 2026-11-09 a setup waited fifteen hours on tools run from the install folder
# (research_e00d8bcfc32e): the bound is what turns a setup that waits like that into a failed run.
# Every step records its result in $Out\steps.tsv and the run carries on, so one failure still leaves the rest observed.
# The repository is public: nothing here prints a secret, and no agent is signed in (connect needs only `claude --version`).
param(
  [Parameter(Mandatory)] [string] $Out,
  [ValidateSet('open', 'closed')] [string] $Session = 'open',
  # The release to install first and the one to update to; empty takes the two newest with this architecture's setup.
  [string] $From = '',
  [string] $To = '',
  # How long the candidate's setup may take, and then how long its app may take to re-point the agents.
  [int] $BoundSeconds = 300,
  [int] $RepointSeconds = 180
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$repo = 'storytree-ai/storytree'
$arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
New-Item -ItemType Directory -Force -Path $Out | Out-Null
$Out = (Resolve-Path -LiteralPath $Out).Path
$stepsFile = Join-Path $Out 'steps.tsv'
Set-Content -LiteralPath $stepsFile -Value "step`tresult`tseconds`tdetail" -Encoding utf8
$storytreeHome = Join-Path $env:USERPROFILE '.storytree\0.3'
$installDir = Join-Path $env:LOCALAPPDATA 'Programs\storytree-0.3'
$appExe = Join-Path $installDir 'storytree-0.3.exe'
$claudeJson = Join-Path $env:USERPROFILE '.claude.json'
$claudeSettings = Join-Path $env:USERPROFILE '.claude\settings.json'
$failed = $false

# Step NAME { … }: the block returns its detail, or throws its failure; either goes to steps.tsv and the log.
function Step([string] $Name, [scriptblock] $Body) {
  $clock = [Diagnostics.Stopwatch]::StartNew()
  try { $detail = [string](& $Body); $result = 'pass' }
  catch { $detail = $_.Exception.Message; $result = 'fail'; $script:failed = $true }
  $line = "$Name`t$result`t$([int]$clock.Elapsed.TotalSeconds)`t$($detail -replace '[\t\r\n]+', ' ')"
  Add-Content -LiteralPath $stepsFile -Value $line -Encoding utf8
  Write-Host "== $line"
  return $result -eq 'pass'
}

function Get-Json([string] $File) { Get-Content -LiteralPath $File -Raw -Encoding UTF8 | ConvertFrom-Json }

function Get-Releases {
  $headers = @{ 'User-Agent' = 'storytree-acceptance'; 'Accept' = 'application/vnd.github+json' }
  if ($env:GH_TOKEN) { $headers.Authorization = "Bearer $env:GH_TOKEN" }
  $list = Invoke-RestMethod "https://api.github.com/repos/$repo/releases?per_page=30" -Headers $headers
  foreach ($release in $list) {
    if ($release.draft -or $release.tag_name -notmatch '^v(0\.3\.(\d+))$') { continue }
    $version = $Matches[1]; $number = [int]$Matches[2]
    $setup = $release.assets | Where-Object name -eq "storytree-0.3-$version-windows-$arch-setup.exe"
    if ($setup) { [pscustomobject]@{ version = $version; number = $number; setup = $setup.browser_download_url } }
  }
}

# A tool started the way an agent starts it: no shell, its output read here, its input kept open until it is closed.
function Start-Tool([string] $Command, [object[]] $Arguments, [string] $Log) {
  $info = [Diagnostics.ProcessStartInfo]::new($Command)
  foreach ($argument in $Arguments) { $info.ArgumentList.Add([string]$argument) }
  $info.UseShellExecute = $false
  $info.CreateNoWindow = $true
  $info.RedirectStandardInput = $true
  $info.RedirectStandardOutput = $true
  $info.RedirectStandardError = $true
  $info.WorkingDirectory = $env:USERPROFILE
  $process = [Diagnostics.Process]::Start($info)
  # Its errors go to a file, so a full error pipe never stalls it.
  $null = $process.StandardError.BaseStream.CopyToAsync([IO.File]::Open($Log, 'Create', 'Write', 'ReadWrite'))
  [pscustomobject]@{ process = $process; pending = $null }
}

function Send-Rpc($Tool, [hashtable] $Message) {
  $Tool.process.StandardInput.WriteLine(($Message | ConvertTo-Json -Compress -Depth 10))
  $Tool.process.StandardInput.Flush()
}

# The answer to request ID, or a throw after TIMEOUT seconds; a line still being read is kept for the next call.
function Read-Rpc($Tool, [int] $Id, [int] $Timeout = 30) {
  $deadline = (Get-Date).AddSeconds($Timeout)
  while ($true) {
    if (-not $Tool.pending) { $Tool.pending = $Tool.process.StandardOutput.ReadLineAsync() }
    $left = [int]($deadline - (Get-Date)).TotalMilliseconds
    if ($left -le 0 -or -not $Tool.pending.Wait($left)) { throw "no answer to request $Id within $Timeout s" }
    $line = $Tool.pending.Result; $Tool.pending = $null
    if ($null -eq $line) { throw "the tool closed its output before answering request $Id (exit $($Tool.process.ExitCode))" }
    try { $message = $line | ConvertFrom-Json } catch { continue }
    if ($message.id -eq $Id) {
      if ($message.error) { throw "request $Id failed: $($message.error.message)" }
      return $message.result
    }
  }
}

function Get-ToolNames($Tool, [int] $Id) {
  Send-Rpc $Tool @{ jsonrpc = '2.0'; id = $Id; method = 'tools/list'; params = @{} }
  $names = @((Read-Rpc $Tool $Id).tools | ForEach-Object name)
  if ($names -notcontains 'check_setup') { throw "tools/list named no check_setup ($($names.Count) tools)" }
  "$($names.Count) tools"
}

# The MCP server the registration names, started and greeted as Claude Code does.
function Start-Mcp([string] $Log) {
  $entry = (Get-Json $claudeJson).mcpServers.storytree
  if (-not $entry) { throw "$claudeJson registers no storytree server" }
  $tool = Start-Tool $entry.command @($entry.args) $Log
  Send-Rpc $tool @{ jsonrpc = '2.0'; id = 1; method = 'initialize'; params = @{ protocolVersion = '2025-11-25'; capabilities = @{}; clientInfo = @{ name = 'windows-update-acceptance'; version = '1' } } }
  $null = Read-Rpc $tool 1 60
  Send-Rpc $tool @{ jsonrpc = '2.0'; method = 'notifications/initialized' }
  $tool
}

function Get-McpScript { [string]@((Get-Json $claudeJson).mcpServers.storytree.args)[0] }

# Every process whose program is under FOLDER: what a setup waiting on "the app is running" would be waiting for.
function Get-ProcessesUnder([string] $Folder) {
  $prefix = $Folder.TrimEnd('\') + '\'
  Get-Process | Where-Object { $_.Path -and $_.Path.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) } |
    ForEach-Object { "$($_.Id) $($_.Path)" }
}

$releases = @(Get-Releases | Sort-Object number -Descending)
if (-not $To) { $To = $releases[0].version }
if (-not $From) { $From = ($releases | Where-Object { $_.number -lt [int]($To -replace '^0\.3\.', '') } | Select-Object -First 1).version }
$candidate = $releases | Where-Object version -eq $To
"from=$From to=$To arch=$arch session=$Session bound=${BoundSeconds}s" | Tee-Object -FilePath (Join-Path $Out 'run.txt')

$null = Step 'machine' { "$([Environment]::OSVersion.VersionString) $env:PROCESSOR_ARCHITECTURE $env:USERNAME" }
if (-not $From -or -not $candidate) {
  $null = Step 'releases' { throw "no Windows $arch setup for from=$From to=$To among the newest releases" }
  exit 1
}

# The previous release, by its own one-liner in Windows PowerShell, as a user installs it.
$installed = Step 'install-from' {
  $script = "`$ProgressPreference = 'SilentlyContinue'; `$env:STORYTREE_ACCEPTANCE_VERSION = '$From'; & ([scriptblock]::Create((Invoke-RestMethod 'https://github.com/$repo/releases/download/v$From/install-storytree.ps1')))"
  $log = Join-Path $Out 'install-from.txt'
  # Started from PowerShell 7, Windows PowerShell would inherit its module path and find no Get-FileHash.
  $modules = $env:PSModulePath
  $env:PSModulePath = [Environment]::GetEnvironmentVariable('PSModulePath', 'Machine')
  try {
    $process = Start-Process powershell.exe -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', $script) -RedirectStandardOutput $log -RedirectStandardError "$log.err" -PassThru -NoNewWindow
    $null = $process.Handle
  } finally { $env:PSModulePath = $modules }
  if (-not $process.WaitForExit(900000)) { $process.Kill($true); throw 'the one-liner did not finish within 15 minutes' }
  if ($process.ExitCode -ne 0) { throw "the one-liner exited $($process.ExitCode)" }
  $version = (Get-Item -LiteralPath $appExe).VersionInfo.FileVersion
  if ($version -ne $From) { throw "installed $version, not $From" }
  "installed $version"
}
if (-not $installed) { exit 1 }

# Holds the installed app's own automatic install for this run's life (contract 4.12), under a name of its own.
$holdFile = Join-Path $storytreeHome "update-holds\$([guid]::NewGuid()).json"
$null = Step 'hold' {
  New-Item -ItemType Directory -Force -Path (Split-Path $holdFile) | Out-Null
  $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  Set-Content -LiteralPath $holdFile -Encoding ascii -Value (@{ run = 'windows-update-acceptance'; startedAt = $now; expiresAt = $now + 3600000 } | ConvertTo-Json -Compress)
  "held as windows-update-acceptance"
}

# Claude Code connected by the installed tools; a stand-in `claude` answers the version check, nothing more.
$tools = $null
$connected = Step 'connect' {
  # Where Claude Code's installer puts it, on the user's PATH: the setup starts the new app through Explorer, which
  # reads that PATH, not this script's.
  $stub = Join-Path $env:USERPROFILE '.local\bin'
  New-Item -ItemType Directory -Force -Path $stub | Out-Null
  Set-Content -LiteralPath (Join-Path $stub 'claude.cmd') -Value '@echo 2.0.0 (Claude Code)' -Encoding ascii
  [Environment]::SetEnvironmentVariable('Path', "$stub;$([Environment]::GetEnvironmentVariable('Path', 'User'))", 'User')
  Add-Type -Namespace StorytreeAcceptance -Name Environment -MemberDefinition '[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint msg, UIntPtr wParam, string lParam, uint flags, uint timeout, out UIntPtr result);'
  $result = [UIntPtr]::Zero
  $null = [StorytreeAcceptance.Environment]::SendMessageTimeout([IntPtr]0xffff, 0x1a, [UIntPtr]::Zero, 'Environment', 2, 5000, [ref]$result)
  $env:Path = "$stub;$env:Path"
  $script:tools = (Get-Json (Join-Path $storytreeHome 'delivery.json')).tools
  & $script:tools.node $script:tools.deliver connect claude-code *> (Join-Path $Out 'connect.txt')
  if ($LASTEXITCODE -ne 0) { throw "connect exited $LASTEXITCODE" }
  "registered $(Get-McpScript)"
}
if (-not $connected) { exit 1 }
$fromMcp = Get-McpScript
# Since contract 1.20 the agents run the build's copy under the home, never the installation's. A release from before
# it fails here and carries on, so the update over tools run from the installation is still observed.
$null = Step 'home-copy' {
  if ($fromMcp.StartsWith($installDir, [StringComparison]::OrdinalIgnoreCase)) { throw "the registration runs the installation's copy: $fromMcp" }
  "runs $(Split-Path $fromMcp)"
}

# An open session: its MCP server answering, and a hook still reading its event, both left running over the update.
$held = @()
if ($Session -eq 'open') {
  $null = Step 'session-open' {
    $script:mcp = Start-Mcp (Join-Path $Out 'held-mcp.err.txt')
    $script:held += $script:mcp.process
    $answer = Get-ToolNames $script:mcp 2
    $hook = ((Get-Json $claudeSettings).hooks.UserPromptSubmit | Select-Object -First 1).hooks | Select-Object -First 1
    $script:hookTool = Start-Tool $hook.command @($hook.args) (Join-Path $Out 'held-hook.err.txt')
    $script:held += $script:hookTool.process
    Start-Sleep -Seconds 3
    if ($script:hookTool.process.HasExited) { throw "the held hook exited $($script:hookTool.process.ExitCode) with its input still open" }
    "MCP server $($script:mcp.process.Id) answers ($answer); hook $($script:hookTool.process.Id) waiting"
  }
}

$setup = Join-Path $Out "storytree-0.3-$To-windows-$arch-setup.exe"
$null = Step 'download-candidate' {
  Invoke-WebRequest $candidate.setup -OutFile $setup -UseBasicParsing
  "$([int]((Get-Item -LiteralPath $setup).Length / 1MB)) MB"
}

# The update, as the app's updater makes it: the installer started as the app quits, with the updater's arguments.
$updated = Step 'update' {
  Get-ProcessesUnder $installDir | Set-Content -LiteralPath (Join-Path $Out 'install-folder-before.txt') -Encoding utf8
  Start-Process -FilePath $appExe -ArgumentList '--quit'
  $process = Start-Process -FilePath $setup -ArgumentList '--updated --force-run' -PassThru
  $null = $process.Handle
  if (-not $process.WaitForExit($BoundSeconds * 1000)) {
    $waiting = @(Get-ProcessesUnder $installDir)
    $waiting | Set-Content -LiteralPath (Join-Path $Out 'install-folder-blocking.txt') -Encoding utf8
    $process.Kill($true)
    throw "the setup had not finished after $BoundSeconds s; running under the installation: $($waiting -join '; ')"
  }
  if ($process.ExitCode -ne 0) { throw "the setup exited $($process.ExitCode)" }
  "finished, exit 0"
}

$null = Step 'version' {
  $version = (Get-Item -LiteralPath $appExe).VersionInfo.FileVersion
  if ($version -ne $To) { throw "installed $version, not $To" }
  "installed $version"
}

# The candidate's app, started by the setup, points the agents at its own build's copy (contract 4.42).
$null = Step 'repoint' {
  $deadline = (Get-Date).AddSeconds($RepointSeconds)
  while ((Get-Date) -lt $deadline) {
    $now = Get-McpScript
    if ($now -ne $fromMcp -and -not $now.StartsWith($installDir, [StringComparison]::OrdinalIgnoreCase)) {
      $hooks = (Get-Content -LiteralPath $claudeSettings -Raw -Encoding UTF8)
      if ($hooks.Contains((Split-Path $fromMcp).Replace('\', '\\'))) { throw "the registration moved to $now, but a hook still runs $(Split-Path $fromMcp)" }
      return "registered $now"
    }
    Start-Sleep -Seconds 5
  }
  throw "the registration still runs $(Get-McpScript) after $RepointSeconds s"
}

# A new session, started from the registration as an agent reconnecting would start it.
$null = Step 'new-session' {
  $fresh = Start-Mcp (Join-Path $Out 'new-mcp.err.txt')
  try { $answer = Get-ToolNames $fresh 2 } finally { $fresh.process.StandardInput.Close(); if (-not $fresh.process.WaitForExit(15000)) { $fresh.process.Kill($true) } }
  $hook = ((Get-Json $claudeSettings).hooks.UserPromptSubmit | Select-Object -First 1).hooks | Select-Object -First 1
  $output = '{}' | & $hook.command $hook.args[0] statusline 2>&1
  if ($LASTEXITCODE -ne 0) { throw "the new hook exited $LASTEXITCODE`: $output" }
  "MCP server answers ($answer); hook answers"
}

# The session left open through the update still has working tools: it kept its own build's copy.
if ($Session -eq 'open') {
  $null = Step 'session-kept' {
    if ($mcp.process.HasExited) { throw "the held MCP server exited $($mcp.process.ExitCode) during the update" }
    "MCP server $($mcp.process.Id) still answers ($(Get-ToolNames $mcp 3))"
  }
}

# What the app and its updater said, and what still runs, for a failure's diagnosis.
$logs = Join-Path $Out 'home'
New-Item -ItemType Directory -Force -Path $logs | Out-Null
Get-ChildItem -LiteralPath $storytreeHome -File -ErrorAction SilentlyContinue | Where-Object { $_.Extension -in '.log', '.json' } | Copy-Item -Destination $logs
Copy-Item -LiteralPath $claudeJson -Destination (Join-Path $Out 'claude.json') -ErrorAction SilentlyContinue
Copy-Item -LiteralPath $claudeSettings -Destination (Join-Path $Out 'claude-settings.json') -ErrorAction SilentlyContinue
Get-Command claude -All -ErrorAction SilentlyContinue | ForEach-Object Source | Set-Content -LiteralPath (Join-Path $Out 'claude-commands.txt') -Encoding utf8
Get-ChildItem -LiteralPath (Join-Path $storytreeHome 'app-tools') -ErrorAction SilentlyContinue | ForEach-Object Name | Set-Content -LiteralPath (Join-Path $Out 'app-tools.txt') -Encoding utf8
Get-Process | Where-Object Path | ForEach-Object { "$($_.Id) $($_.Path)" } | Set-Content -LiteralPath (Join-Path $Out 'processes-after.txt') -Encoding utf8
foreach ($process in $held) { if (-not $process.HasExited) { $process.Kill($true) } }
Start-Process -FilePath $appExe -ArgumentList '--quit'
Remove-Item -LiteralPath $holdFile -Force -ErrorAction SilentlyContinue
Get-Content -LiteralPath $stepsFile
if ($failed) { exit 1 }
