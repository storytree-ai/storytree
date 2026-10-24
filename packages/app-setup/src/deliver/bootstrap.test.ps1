$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/install.ps1" -LibraryOnly
function Assert($Condition, $Message) { if (-not $Condition) { throw $Message } }
# Get storytree 1.10: stable is the first install default; existing installs keep their channel.
$channelRoot = Join-Path ([IO.Path]::GetTempPath()) ('storytree-channels-' + [Guid]::NewGuid().ToString('N'))
$channelHome = Join-Path $channelRoot 'home'
$channelInstall = Join-Path $channelRoot 'app'
$channelFile = Join-Path $channelHome 'release-channel.json'
try {
  Assert ((Resolve-StorytreeChannel $channelHome $channelInstall '') -eq 'stable') 'new installation defaults to stable'
  Assert (-not (Test-Path -LiteralPath $channelFile)) 'choosing a channel writes nothing before a download succeeds'
  Save-StorytreeChannel $channelHome 'stable'
  $saved = Get-Content -LiteralPath $channelFile -Raw | ConvertFrom-Json
  Assert ($saved.schema -eq 1 -and $saved.channel -ceq 'stable') 'saving puts the channel on disk'
  Assert ((Resolve-StorytreeChannel $channelHome $channelInstall '') -eq 'stable') 'rerun keeps stable'
  # A record with no installed app is what a failed download left behind: an explicit choice replaces it.
  Assert ((Resolve-StorytreeChannel $channelHome $channelInstall 'alpha') -eq 'alpha') 'retry on alpha after a failed stable download'
  Save-StorytreeChannel $channelHome 'alpha'
  Assert ((Get-Content -LiteralPath $channelFile -Raw | ConvertFrom-Json).channel -ceq 'alpha') 'the explicit retry replaces the leftover record'
  Save-StorytreeChannel $channelHome 'stable'
  New-Item -ItemType Directory -Path $channelInstall -Force | Out-Null
  [IO.File]::WriteAllText((Join-Path $channelInstall 'storytree-0.3.exe'), 'app')
  try { Resolve-StorytreeChannel $channelHome $channelInstall 'alpha'; throw 'accepted conflict' }
  catch { Assert ($_.Exception.Message -match 'already.*stable') 'an explicit conflicting channel cannot silently migrate an install' }
  Remove-Item -LiteralPath (Join-Path $channelInstall 'storytree-0.3.exe')
  [IO.File]::WriteAllText($channelFile, '{broken')
  try { Resolve-StorytreeChannel $channelHome $channelInstall ''; throw 'unexpected success' }
  catch { Assert ($_.Exception.Message -match 'channel') 'corrupt saved channel stops delivery' }
  [IO.File]::WriteAllText($channelFile, '{"schema":1,"channel":"preview"}')
  try { Resolve-StorytreeChannel $channelHome $channelInstall ''; throw 'unexpected success' }
  catch { Assert ($_.Exception.Message -match 'channel') 'unknown saved channel stops delivery' }
  Remove-Item -LiteralPath $channelFile
  New-Item -ItemType Directory -Path (Join-Path $channelInstall 'resources') -Force | Out-Null
  [IO.File]::WriteAllText((Join-Path $channelInstall 'resources/storytree-installed'), 'nsis')
  try { Resolve-StorytreeChannel $channelHome $channelInstall 'stable'; throw 'accepted legacy switch' }
  catch { Assert ($_.Exception.Message -match 'already.*alpha') 'stable default cannot overwrite legacy alpha' }
  Assert ((Resolve-StorytreeChannel $channelHome $channelInstall '') -eq 'alpha') 'legacy owner install remains alpha'
  # Alpha's old name, development, is what an owner install saved before ADR-1121: it reads as alpha.
  Save-StorytreeChannel $channelHome 'development'
  [IO.File]::WriteAllText((Join-Path $channelInstall 'resources/storytree-installed'), 'nsis-stable')
  Assert ((Resolve-StorytreeChannel $channelHome $channelInstall '') -eq 'alpha') 'saved channel survives a newer marker'
  try { Resolve-StorytreeChannel $channelHome $channelInstall 'stable'; throw 'accepted conflict' }
  catch { Assert ($_.Exception.Message -match 'already.*alpha') 'a marked installation keeps its saved channel' }
  Remove-Item -LiteralPath $channelFile
  Assert ((Resolve-StorytreeChannel $channelHome $channelInstall '') -eq 'stable') 'new installer marker selects stable'
  Remove-Item -LiteralPath $channelInstall -Recurse -Force
  Assert ((Resolve-StorytreeChannel $channelHome $channelInstall 'alpha') -eq 'alpha') 'a fresh install accepts explicit alpha'
  Assert ((Resolve-StorytreeChannel $channelHome $channelInstall 'development') -eq 'alpha') "the old one-liner's -Channel development asks for alpha"
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
Get-StorytreeRelease 'alpha' $fetchRelease | Out-Null
Assert (($script:ReleaseUrls -join ',') -eq 'https://api.github.com/repos/storytree-ai/storytree/releases/latest') 'explicit alpha follows releases'
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
# An acceptance run installs a named build as a stable user would get it, before the pin moves to it.
$script:ReleaseUrls.Clear()
$selected = Get-StorytreeRelease 'stable' $fetchRelease '0.3.123'
Assert ($selected.tag_name -eq 'v0.3.123') 'an acceptance version selects that release'
Assert (($script:ReleaseUrls -join ',') -eq 'https://api.github.com/repos/storytree-ai/storytree/releases/tags/v0.3.123') 'an acceptance version reads neither the pin nor latest'
try { Get-StorytreeRelease 'alpha' $fetchRelease '0.3.123'; throw 'accepted alpha' }
catch { Assert ($_.Exception.Message -match 'installs as stable') 'an acceptance version on alpha stops delivery' }
try { Get-StorytreeRelease 'stable' $fetchRelease 'latest'; throw 'accepted latest' }
catch { Assert ($_.Exception.Message -match '0\.3\.<n>') 'an acceptance version that names no release stops delivery' }
try { Get-StorytreeRelease 'stable' $fetchRelease '0.3.124'; throw 'accepted another build' }
catch { Assert ($_.Exception.Message -match 'does not match') 'an acceptance version whose release is another build stops delivery' }
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
  Persist = { $script:Calls.Add('persist') }
  Install = { param($Installer, $Dir) $script:Calls.Add('install'); if ($script:Fail -eq 'install') { throw 'refused' }; $script:Usable = $true }
  Finish = { param($Dir, $Arch) $script:Calls.Add('finish'); if ($script:Fail -eq 'finish') { throw 'database did not start' }; return @{ command = @{ status = 'installed'; pathEntry = 'new bin' } } }
  Path = { param($Report) $script:Calls.Add('path'); if ($script:Fail -eq 'path') { throw 'registry refused' } }
}
foreach ($arch in @('x64', 'arm64')) {
  $script:Usable = $false; $script:Calls.Clear()
  $answer = Invoke-StorytreeDelivery 'app with spaces' $arch $ops
  Assert ($answer.state -eq 'ready') 'clean install ready'
  Assert (($script:Calls -join ',') -eq "probe:$arch,stage:download,download:$arch,persist,stage:install,install,stage:verify,probe:$arch,stage:finish,finish,stage:path,path") 'clean install saves its channel only after the download, before the installer can launch the app'
  $script:Calls.Clear()
  $answer = Invoke-StorytreeDelivery 'app with spaces' $arch $ops
  Assert ($answer.state -eq 'ready') 'repeat ready'
  Assert (($script:Calls -join ',') -eq "probe:$arch,persist,stage:finish,finish,stage:path,path") 'repeat must not download or reinstall'
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
  if ($step -eq 'download') { Assert (-not $script:Calls.Contains('persist')) 'a failed download leaves no channel record behind' }
  $script:Fail = ''
  Assert ((Invoke-StorytreeDelivery 'app with spaces' 'arm64' $ops).state -eq 'ready') 'safe retry'
}
Assert ((Add-StorytreePath 'C:\Other;%USERPROFILE%\bin' 'C:\Storytree\bin') -eq 'C:\Other;%USERPROFILE%\bin;C:\Storytree\bin') 'preserve existing PATH text'
Assert ((Add-StorytreePath 'C:\Other;C:\Storytree\bin\' 'c:\storytree\bin') -eq 'C:\Other;C:\Storytree\bin\') 'PATH rerun is idempotent'
$base = 'https://github.com/storytree-ai/storytree/releases/download'
$asset = { param($Tag, $Name) @{ name = $Name; browser_download_url = "$base/$Tag/$Name" } }
$release = @{ tag_name = 'v0.3.123'; draft = $false; prerelease = $false; assets = @((& $asset 'v0.3.123' 'storytree-0.3-0.3.123-windows-x64-setup.exe'), (& $asset 'v0.3.123' 'storytree-0.3-0.3.123-windows-arm64-setup.exe')) }
$manifest = @{ schema = 1; version = '0.3.123'; architectures = @('x64', 'arm64'); installers = @{ x64 = @{ name = 'storytree-0.3-0.3.123-windows-x64-setup.exe'; sha256 = ('a' * 64) }; arm64 = @{ name = 'storytree-0.3-0.3.123-windows-arm64-setup.exe'; sha256 = ('c' * 64) } } }
$arm = Select-StorytreeInstaller $release $manifest 'arm64'
Assert ($arm.sha256 -eq ('c' * 64) -and $arm.name -ceq 'storytree-0.3-0.3.123-windows-arm64-setup.exe' -and $arm.url -ceq "$base/v0.3.123/storytree-0.3-0.3.123-windows-arm64-setup.exe") 'an arm64 machine downloads only the arm64 installer'
Assert ((Select-StorytreeInstaller $release $manifest 'x64').url -ceq "$base/v0.3.123/storytree-0.3-0.3.123-windows-x64-setup.exe") 'an x64 machine downloads only the x64 installer'
try { Select-StorytreeInstaller $release $manifest 'arm64' 'stable'; throw 'unexpected success' }
catch { Assert ($_.Exception.Message -match 'channel') 'stable refuses a release whose app cannot honor the saved channel' }
$manifest.channelSchema = 1
Assert ((Select-StorytreeInstaller $release $manifest 'arm64' 'stable').sha256 -eq ('c' * 64)) 'stable accepts a channel-aware installer'
$manifest.installers.Remove('arm64')
try { Select-StorytreeInstaller $release $manifest 'arm64'; throw 'accepted a missing architecture' } catch { Assert ($_.Exception.Message -match 'installer checksum') 'refuse a release with no installer for this architecture' }
$manifest.version = '0.3.122'
try { Select-StorytreeInstaller $release $manifest 'x64'; throw 'accepted stale manifest' } catch { Assert ($_.Exception.Message -match 'does not match') 'reject mixed releases' }
# A release from before the split carries both architectures in one installer, which still installs.
$combined = @{ tag_name = 'v0.3.121'; draft = $false; prerelease = $false; assets = @(& $asset 'v0.3.121' 'storytree-0.3-0.3.121-setup.exe') }
$combinedManifest = @{ schema = 1; channelSchema = 1; version = '0.3.121'; architectures = @('x64', 'arm64'); installer = @{ name = 'storytree-0.3-0.3.121-setup.exe'; sha256 = ('d' * 64) } }
Assert ((Select-StorytreeInstaller $combined $combinedManifest 'arm64' 'stable').url -ceq "$base/v0.3.121/storytree-0.3-0.3.121-setup.exe") 'an earlier combined installer is selected on either architecture'
# A release whose Windows build failed names the last good installers, with their version; that build's release has them (4.6).
$earlier = @{ tag_name = 'v0.3.122'; draft = $false; prerelease = $false; assets = @((& $asset 'v0.3.122' 'storytree-delivery.json'), (& $asset 'v0.3.122' 'storytree-0.3-0.3.122-windows-x64-setup.exe'), (& $asset 'v0.3.122' 'storytree-0.3-0.3.122-windows-arm64-setup.exe')) }
$entry = { param($Arch, $Hash) @{ name = "storytree-0.3-0.3.122-windows-$Arch-setup.exe"; sha256 = ($Hash * 64) } }
$earlierManifest = @{ schema = 1; version = '0.3.122'; architectures = @('x64', 'arm64'); installers = @{ x64 = (& $entry 'x64' 'b'); arm64 = (& $entry 'arm64' 'e') } }
$script:Fetched = @()
$fetch = { param($Url) $script:Fetched += $Url; if ($Url -ceq 'https://api.github.com/repos/storytree-ai/storytree/releases/tags/v0.3.122') { return $earlier }; throw "unexpected $Url" }
$readManifest = { param($Url) $script:Fetched += $Url; return $earlierManifest }
$carried = @{ schema = 1; version = '0.3.123'; architectures = @('x64', 'arm64'); installers = @{ x64 = (& $entry 'x64' 'b') + @{ version = '0.3.122' }; arm64 = (& $entry 'arm64' 'e') + @{ version = '0.3.122' } } }
$build = Get-StorytreeWindowsBuild $release $carried 'arm64' $fetch $readManifest
Assert ($build.release.tag_name -ceq 'v0.3.122' -and $build.manifest.version -ceq '0.3.122') 'a carried Windows build is read from its own release'
Assert (($script:Fetched -join ' ') -ceq "https://api.github.com/repos/storytree-ai/storytree/releases/tags/v0.3.122 $base/v0.3.122/storytree-delivery.json") 'and its own manifest'
Assert ((Select-StorytreeInstaller $build.release $build.manifest 'arm64').sha256 -eq ('e' * 64)) 'its installer is selected as any release''s is'
$own = Get-StorytreeWindowsBuild $release $earlierManifest 'x64' $fetch $readManifest
Assert ($own.release.tag_name -ceq 'v0.3.123') 'a release with its own Windows build is used as it is'
# A build carried from before the split names its one installer's version.
$carriedCombined = @{ schema = 1; version = '0.3.123'; architectures = @('x64', 'arm64'); installer = @{ name = 'storytree-0.3-0.3.122-setup.exe'; sha256 = ('b' * 64); version = '0.3.122' } }
Assert ((Get-StorytreeWindowsBuild $release $carriedCombined 'x64' $fetch $readManifest).release.tag_name -ceq 'v0.3.122') 'a carried combined build is read from its own release'
$carried.installers.arm64.version = 'latest'
try { Get-StorytreeWindowsBuild $release $carried 'arm64' $fetch $readManifest; throw 'accepted a carried entry naming no build' } catch { Assert ($_.Exception.Message -match 'no valid Windows build') 'refuse a carried entry naming no build' }
$carried.installers.arm64.version = '0.3.122'
$earlierManifest.installers.arm64.version = '0.3.121'
try { Get-StorytreeWindowsBuild $release $carried 'arm64' $fetch $readManifest; throw 'followed a second carry' } catch { Assert ($_.Exception.Message -match 'does not name its own Windows build') 'a carried build is followed once, to a release that built it' }
$file = [IO.Path]::GetTempFileName()
try {
  [IO.File]::WriteAllText($file, 'interrupted download')
  try { Assert-StorytreeDownload $file ('a' * 64); throw 'accepted damaged download' } catch { Assert ($_.Exception.Message -match 'checksum') "reject damaged installer before running it: $($_.Exception.Message)" }
} finally { Remove-Item -LiteralPath $file }
# Once installed it asks nothing (1.15, ADR-1162): its first words after the install say how to open the app.
$dir = Join-Path ([IO.Path]::GetTempPath()) "it's storytree"
$app = ([IO.Path]::GetTempPath().TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar + "it''s storytree" + [IO.Path]::DirectorySeparatorChar + 'storytree-0.3.exe')
$lines = @(Get-StorytreeOpenedLines $dir @{ command = @{ status = 'installed'; replaced = @('C:\old\storytree.exe') }; tools = @{} })
Assert ($lines[0] -ceq "storytree is installed, and its app is open. To open it again, use the Start menu, or run: & '$app'") "opening the app comes first: $($lines[0])"
Assert ($lines[1] -ceq 'In the app, connect your coding agents and, when you want one, add a project.') 'agents and a project are left to the app'
Assert (($lines[2..3] -join '|') -ceq 'The storytree command is available in a fresh Windows terminal.|An older storytree command now runs this installation: C:\old\storytree.exe') 'then the command, and an older one it repointed'
$lines = @(Get-StorytreeOpenedLines $dir @{ command = @{ status = 'conflict'; conflict = 'C:\other\storytree.exe' }; tools = @{ node = 'n'; cli = 'c' } })
Assert (($lines[2..3] -join '|') -ceq "An existing storytree command was preserved: C:\other\storytree.exe|Run this installation explicitly: & 'n' 'c'") 'a conflicting command is named after the app'
Write-Output 'delivery bootstrap PASS'
