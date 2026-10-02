$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/install.ps1" -LibraryOnly
function Assert($Condition, $Message) { if (-not $Condition) { throw $Message } }
# Get storytree 1.10: stable is the first install default; existing installs keep their channel.
$channelRoot = Join-Path ([IO.Path]::GetTempPath()) ('storytree-channels-' + [Guid]::NewGuid().ToString('N'))
$channelHome = Join-Path $channelRoot 'home'
$channelInstall = Join-Path $channelRoot 'app'
$channelFile = Join-Path $channelHome 'release-channel.json'
try {
  Assert ((Initialize-StorytreeChannel $channelHome $channelInstall '') -eq 'stable') 'new installation defaults to stable'
  $saved = Get-Content -LiteralPath $channelFile -Raw | ConvertFrom-Json
  Assert ($saved.schema -eq 1 -and $saved.channel -ceq 'stable') 'channel is on disk before delivery can launch the installer'
  Assert ((Initialize-StorytreeChannel $channelHome $channelInstall '') -eq 'stable') 'rerun keeps stable'
  try { Initialize-StorytreeChannel $channelHome $channelInstall 'development'; throw 'accepted conflict' }
  catch { Assert ($_.Exception.Message -match 'already.*stable') 'an explicit conflicting channel cannot silently migrate an install' }
  [IO.File]::WriteAllText($channelFile, '{broken')
  try { Initialize-StorytreeChannel $channelHome $channelInstall ''; throw 'accepted corrupt channel' }
  catch { Assert ($_.Exception.Message -match 'channel') 'corrupt saved channel stops delivery' }
  [IO.File]::WriteAllText($channelFile, '{"schema":1,"channel":"preview"}')
  try { Initialize-StorytreeChannel $channelHome $channelInstall ''; throw 'accepted unknown channel' }
  catch { Assert ($_.Exception.Message -match 'channel') 'unknown saved channel stops delivery' }
  Remove-Item -LiteralPath $channelFile
  New-Item -ItemType Directory -Path (Join-Path $channelInstall 'resources') -Force | Out-Null
  [IO.File]::WriteAllText((Join-Path $channelInstall 'resources/storytree-installed'), 'nsis')
  try { Initialize-StorytreeChannel $channelHome $channelInstall 'stable'; throw 'accepted legacy switch' }
  catch { Assert ($_.Exception.Message -match 'already.*development') 'stable default cannot overwrite legacy development' }
  Assert ((Initialize-StorytreeChannel $channelHome $channelInstall '') -eq 'development') 'legacy owner install remains development'
  [IO.File]::WriteAllText((Join-Path $channelInstall 'resources/storytree-installed'), 'nsis-stable')
  Assert ((Initialize-StorytreeChannel $channelHome $channelInstall '') -eq 'development') 'saved channel survives a newer marker'
  Remove-Item -LiteralPath $channelFile
  Assert ((Initialize-StorytreeChannel $channelHome $channelInstall '') -eq 'stable') 'new installer marker selects stable'
  Remove-Item -LiteralPath $channelFile
  Remove-Item -LiteralPath $channelInstall -Recurse -Force
  Assert ((Initialize-StorytreeChannel $channelHome $channelInstall 'development') -eq 'development') 'a fresh install accepts explicit development'
} finally { if (Test-Path -LiteralPath $channelRoot) { Remove-Item -LiteralPath $channelRoot -Recurse -Force } }
$script:ReleaseUrls = [Collections.Generic.List[string]]::new()
$script:StablePointer = @{ schema = 1; channel = 'stable'; version = '0.3.123' }
$script:PointerFails = $false
$fetchRelease = {
  param($Url)
  $script:ReleaseUrls.Add($Url)
  if ($Url -match 'release-channel-stable/latest.yml$') {
    if ($script:PointerFails) { throw 'stable is unavailable' }
    return $script:StablePointer
  }
  return @{ tag_name = 'v0.3.123'; draft = $false; prerelease = $false }
}
$selected = Get-StorytreeRelease 'stable' $fetchRelease
Assert ($selected.tag_name -eq 'v0.3.123') 'stable selects the pinned release'
Assert (($script:ReleaseUrls -join ',') -eq 'https://raw.githubusercontent.com/storytree-ai/storytree/release-channel-stable/latest.yml,https://api.github.com/repos/storytree-ai/storytree/releases/tags/v0.3.123') 'stable never consults latest'
$script:ReleaseUrls.Clear()
Get-StorytreeRelease 'development' $fetchRelease | Out-Null
Assert (($script:ReleaseUrls -join ',') -eq 'https://api.github.com/repos/storytree-ai/storytree/releases/latest') 'explicit development follows releases'
foreach ($bad in @(@{schema=2;channel='stable';version='0.3.123'}, @{schema=1;channel='development';version='0.3.123'}, @{schema=1;channel='stable';version='evil/path'})) {
  $script:StablePointer = $bad; $script:ReleaseUrls.Clear()
  try { Get-StorytreeRelease 'stable' $fetchRelease; throw 'accepted invalid pointer' }
  catch { Assert ($_.Exception.Message -match 'stable') 'invalid stable pointer stops delivery' }
  Assert ($script:ReleaseUrls.Count -eq 1) 'invalid pointer has no latest fallback'
}
$script:PointerFails = $true; $script:ReleaseUrls.Clear()
try { Get-StorytreeRelease 'stable' $fetchRelease; throw 'accepted missing pin' }
catch { Assert ($_.Exception.Message -match 'stable') 'missing stable pin stops delivery' }
Assert ($script:ReleaseUrls.Count -eq 1) 'missing stable pin has no latest fallback'
Assert ((Get-StorytreeArchitecture 'AMD64' '') -eq 'x64') 'x64 selection'
Assert ((Get-StorytreeArchitecture 'x86' 'ARM64') -eq 'arm64') 'native arm64 selection under emulation'
Assert ((Get-StorytreeArchitecture 'ARM64' '') -eq 'arm64') 'native arm64 selection'
try { Get-StorytreeArchitecture 'x86' ''; throw 'accepted x86' } catch { Assert ($_.Exception.Message -match 'unsupported') 'reject unsupported architecture' }
$script:Calls = [Collections.Generic.List[string]]::new()
$script:Usable = $false
$script:Fail = ''
$ops = @{
  Stage = { param($Step) $script:Calls.Add("stage:$Step") }
  Probe ={ param($Dir, $Arch) $script:Calls.Add("probe:$Arch"); return $script:Usable }
  Download = { param($Arch) $script:Calls.Add("download:$Arch"); if ($script:Fail -eq 'download') { throw 'offline' }; return 'verified installer' }
  Install = { param($Installer, $Dir) $script:Calls.Add('install'); if ($script:Fail -eq 'install') { throw 'refused' }; $script:Usable = $true }
  Finish = { param($Dir, $Arch) $script:Calls.Add('finish'); if ($script:Fail -eq 'finish') { throw 'database did not start' }; return @{ command = @{ status = 'installed'; pathEntry = 'new bin' } } }
  Path = { param($Report) $script:Calls.Add('path'); if ($script:Fail -eq 'path') { throw 'registry refused' } }
}
foreach ($arch in @('x64', 'arm64')) {
  $script:Usable = $false; $script:Calls.Clear()
  $answer = Invoke-StorytreeDelivery 'app with spaces' $arch $ops
  Assert ($answer.state -eq 'ready') 'clean install ready'
  Assert (($script:Calls -join ',') -eq "probe:$arch,stage:download,download:$arch,stage:install,install,stage:verify,probe:$arch,stage:finish,finish,stage:path,path") 'clean install names each stage before it runs'
  $script:Calls.Clear()
  $answer = Invoke-StorytreeDelivery 'app with spaces' $arch $ops
  Assert ($answer.state -eq 'ready') 'repeat ready'
  Assert (($script:Calls -join ',') -eq "probe:$arch,stage:finish,finish,stage:path,path") 'repeat must not download or reinstall'
}
# A download reports its size, speed and time left while it runs, and ends on the whole size.
$payload = New-Object byte[] (3MB + 17)
$script:Reports = [Collections.Generic.List[object]]::new()
$target = [IO.MemoryStream]::new()
Copy-StorytreeStream ([IO.MemoryStream]::new($payload)) $target $payload.Length { param($Progress) $script:Reports.Add($Progress) } | Out-Null
Assert ($target.Length -eq $payload.Length) 'every byte copied'
$last = $script:Reports[$script:Reports.Count - 1]
Assert ($last.percent -eq 100) "final report is complete: $($last.percent)"
Assert ($last.status -match '3\.0 MB of 3\.0 MB' -and $last.status -match 'MB/s' -and $last.status -match 'left') "report carries size, speed and time left: $($last.status)"
$half = Get-StorytreeProgress 50MB 100MB 10
Assert ($half.percent -eq 50 -and $half.status -match '50\.0 MB of 100\.0 MB, 5\.0 MB/s, about 10 s left') "half-way estimate: $($half.status)"
Assert ((Get-StorytreeProgress 10MB 370MB 2).status -match 'about 1 min 12 s left') 'minutes shown for a long wait'
Assert ((Get-StorytreeProgress 1MB 370MB 0.1).status -match 'estimating') 'no wild estimate from the first fraction of a second'
Assert ((Get-StorytreeProgress 5MB -1 1).percent -eq -1) 'unknown size shows no false percentage'
try { Copy-StorytreeStream ([IO.MemoryStream]::new($payload, 0, 1024)) ([IO.MemoryStream]::new()) $payload.Length { param($p) } | Out-Null; throw 'accepted short download' }
catch { Assert ($_.Exception.Message -match 'ended early') "a cut-off download is refused: $($_.Exception.Message)" }
# The silent install shows it is still working while the installer runs.
$script:Ticks = 0
$start = [Diagnostics.ProcessStartInfo]::new([Diagnostics.Process]::GetCurrentProcess().Path, '-NoProfile -Command Start-Sleep -Milliseconds 2500')
$start.UseShellExecute = $false; $start.CreateNoWindow = $true
$sleeper = [Diagnostics.Process]::Start($start)
$null = $sleeper.Handle
Wait-StorytreeProcess $sleeper { param($Elapsed) $script:Ticks++ } | Out-Null
Assert ($sleeper.HasExited -and $sleeper.ExitCode -eq 0) 'waited for the installer and kept its exit code'
Assert ($script:Ticks -ge 1) "install wait ticked while running: $script:Ticks"
foreach ($step in @('download', 'install', 'finish', 'path')) {
  $script:Usable = $false; $script:Calls.Clear(); $script:Fail = $step
  try { Invoke-StorytreeDelivery 'app with spaces' 'arm64' $ops; throw 'accepted failure' }
  catch { Assert ($_.Exception.Message -match "$step.*[Rr]etry") "failure names $step and retry" }
  if ($step -in @('download', 'install')) { Assert (-not $script:Calls.Contains('finish')) 'failure cannot announce app readiness' }
  $script:Fail = ''
  Assert ((Invoke-StorytreeDelivery 'app with spaces' 'arm64' $ops).state -eq 'ready') 'safe retry'
}
Assert ((Add-StorytreePath 'C:\Other;%USERPROFILE%\bin' 'C:\Storytree\bin') -eq 'C:\Other;%USERPROFILE%\bin;C:\Storytree\bin') 'preserve existing PATH text'
Assert ((Add-StorytreePath 'C:\Other;C:\Storytree\bin\' 'c:\storytree\bin') -eq 'C:\Other;C:\Storytree\bin\') 'PATH rerun is idempotent'
$release = @{ tag_name = 'v0.3.123'; draft = $false; prerelease = $false; assets = @(@{ name = 'storytree-0.3-0.3.123-setup.exe'; browser_download_url = 'https://github.com/storytree-ai/storytree/releases/download/v0.3.123/storytree-0.3-0.3.123-setup.exe' }) }
$manifest = @{ schema = 1; version = '0.3.123'; architectures = @('x64', 'arm64'); installer = @{ name = 'storytree-0.3-0.3.123-setup.exe'; sha256 = ('a' * 64) } }
Assert ((Select-StorytreeInstaller $release $manifest 'arm64').sha256 -eq ('a' * 64)) 'select the combined NSIS installer'
try { Select-StorytreeInstaller $release $manifest 'arm64' 'stable'; throw 'accepted pre-channel build' }
catch { Assert ($_.Exception.Message -match 'channel') 'stable refuses a release whose app cannot honor the saved channel' }
$manifest.channelSchema = 1
Assert ((Select-StorytreeInstaller $release $manifest 'arm64' 'stable').sha256 -eq ('a' * 64)) 'stable accepts a channel-aware installer'
$manifest.version = '0.3.122'
try { Select-StorytreeInstaller $release $manifest 'x64'; throw 'accepted stale manifest' } catch { Assert ($_.Exception.Message -match 'does not match') 'reject mixed releases' }
$file = [IO.Path]::GetTempFileName()
try {
  [IO.File]::WriteAllText($file, 'interrupted download')
  try { Assert-StorytreeDownload $file ('a' * 64); throw 'accepted damaged download' } catch { Assert ($_.Exception.Message -match 'checksum') "reject damaged installer before running it: $($_.Exception.Message)" }
} finally { Remove-Item -LiteralPath $file }
$report = @{ tools = @{ node = 'installed node with spaces'; cli = 'installed cli with spaces' } }
$script:Selected = ''
$script:Connected = @()
$join = @{
  Choose = { return $script:Selected }
  Connect = { param($Tools, $Flags) Assert ($Tools.node -eq $report.tools.node) 'use delivered Node'; Assert ($Tools.cli -eq $report.tools.cli) 'use delivered CLI'; $script:Connected = @($Flags) }
}
foreach ($choice in @('1', '2', '3', 's')) {
  $script:Selected = $choice; $script:Connected = @()
  Invoke-StorytreeConnection $report $join
  $expected = switch ($choice) { '1' { '--claude' } '2' { '--codex' } '3' { '--claude,--codex' } 's' { '' } }
  Assert (($script:Connected -join ',') -eq $expected) "connection selection $choice"
}
$script:Selected = 'invalid'
try { Invoke-StorytreeConnection $report $join; throw 'accepted invalid selection' }
catch { Assert ($_.Exception.Message -match 'Choose 1, 2, 3 or S') 'invalid choice cannot connect silently' }
$script:Selected = '3'
$join.Connect = { throw 'one agent could not connect' }
try { Invoke-StorytreeConnection $report $join; throw 'accepted partial failure' }
catch { Assert ($_.Exception.Message -match 'one agent could not connect') 'connection failure reaches installer caller' }
$here = [IO.Path]::GetFullPath((Join-Path ([IO.Path]::GetTempPath()) 'folder with spaces'))
$userHome = [IO.Path]::GetFullPath((Join-Path ([IO.Path]::GetTempPath()) 'the user'))
$script:Answers = [Collections.Generic.Queue[string]]::new()
$script:SetUps = [Collections.Generic.List[string]]::new()
$script:Existing = $null
$script:Refuse = ''
$folderOps = @{
  Ask = { param($Prompt) if ($script:Answers.Count -gt 0) { return $script:Answers.Dequeue() }; return '' }
  Inspect = { param($Folder) if ($script:Existing) { return @{ folder = $Folder; project = $script:Existing } }; return @{ folder = $Folder; suggestion = 'folder-with-spaces' } }
  SetUp = {
    param($Folder, $Name)
    $script:SetUps.Add("${Folder}|${Name}")
    if ($Name -eq $script:Refuse) { return @{ status = 'name refused'; message = 'project name is not allowed' } }
    return @{ status = 'set up'; folder = $Folder; project = $Name }
  }
}
function Test-ProjectFolder([string[]]$Answers, [string]$From = $here) {
  $script:Answers.Clear(); foreach ($a in $Answers) { $script:Answers.Enqueue($a) }
  $script:SetUps.Clear()
  Invoke-StorytreeProjectFolder $From $userHome $folderOps
  return ($script:SetUps -join ';')
}
Assert ((Test-ProjectFolder @('', '')) -eq "$here|folder-with-spaces") 'Enter twice sets up the folder the command ran from, under its suggested name'
Assert ((Test-ProjectFolder @()) -eq "$here|folder-with-spaces") 'an ended stdin accepts both defaults'
$typed = [IO.Path]::GetFullPath([IO.Path]::Combine($here, 'my site'))
Assert ((Test-ProjectFolder @('my site', 'site-x')) -eq "$typed|site-x") 'a typed relative path and name'
$absolute = [IO.Path]::GetFullPath((Join-Path ([IO.Path]::GetTempPath()) 'elsewhere'))
Assert ((Test-ProjectFolder @("`"$absolute`"", '')) -eq "$absolute|folder-with-spaces") 'a typed absolute path, quotes stripped'
Assert ((Test-ProjectFolder @('S')) -eq '') 'S skips and sets nothing up'
$script:Existing = 'site'
Assert ((Test-ProjectFolder @('', 'never asked')) -eq '') 'a folder that is already a project creates nothing'
Assert ($script:Answers.Count -eq 1) 'an existing project is not asked for a name'
$script:Existing = $null
$script:Refuse = 'Bad Name'
Assert ((Test-ProjectFolder @('', 'Bad Name', '')) -eq "$here|Bad Name;$here|folder-with-spaces") 'a refused name is asked again'
$script:Refuse = ''
Assert ((Test-ProjectFolder @('') $userHome) -eq '') 'Enter in the home folder sets nothing up: the whole account would become one project'
Assert ((Test-ProjectFolder @('code', 'code') $userHome) -eq "$([IO.Path]::GetFullPath((Join-Path $userHome 'code')))|code") 'a typed folder under home is fine'
$folderOps.SetUp = { param($Folder, $Name) throw 'the library could not be reached' }
try { Test-ProjectFolder @('', '') | Out-Null; throw 'accepted failed setup' }
catch { Assert ($_.Exception.Message -match 'library could not be reached' -and $_.Exception.Message -match 'doctor --set-up' -and $_.Exception.Message -match 'Add project') "failed setup names the later ways: $($_.Exception.Message)" }
Write-Output 'delivery bootstrap PASS'
