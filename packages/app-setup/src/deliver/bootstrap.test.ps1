$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/install.ps1" -LibraryOnly
function Assert($Condition, $Message) { if (-not $Condition) { throw $Message } }
Assert ((Get-StorytreeArchitecture 'AMD64' '') -eq 'x64') 'x64 selection'
Assert ((Get-StorytreeArchitecture 'x86' 'ARM64') -eq 'arm64') 'native arm64 selection under emulation'
Assert ((Get-StorytreeArchitecture 'ARM64' '') -eq 'arm64') 'native arm64 selection'
try { Get-StorytreeArchitecture 'x86' ''; throw 'accepted x86' } catch { Assert ($_.Exception.Message -match 'unsupported') 'reject unsupported architecture' }
$script:Calls = [Collections.Generic.List[string]]::new()
$script:Usable = $false
$script:Fail = ''
$ops = @{
  Probe = { param($Dir, $Arch) $script:Calls.Add("probe:$Arch"); return $script:Usable }
  Download = { param($Arch) $script:Calls.Add("download:$Arch"); if ($script:Fail -eq 'download') { throw 'offline' }; return 'verified installer' }
  Install = { param($Installer, $Dir) $script:Calls.Add('install'); if ($script:Fail -eq 'install') { throw 'refused' }; $script:Usable = $true }
  Finish = { param($Dir, $Arch) $script:Calls.Add('finish'); if ($script:Fail -eq 'finish') { throw 'database did not start' }; return @{ command = @{ status = 'installed'; pathEntry = 'new bin' } } }
  Path = { param($Report) $script:Calls.Add('path'); if ($script:Fail -eq 'path') { throw 'registry refused' } }
}
foreach ($arch in @('x64', 'arm64')) {
  $script:Usable = $false; $script:Calls.Clear()
  $answer = Invoke-StorytreeDelivery 'app with spaces' $arch $ops
  Assert ($answer.state -eq 'ready') 'clean install ready'
  Assert (($script:Calls -join ',') -eq "probe:$arch,download:$arch,install,probe:$arch,finish,path") 'clean install sequence'
  $script:Calls.Clear()
  $answer = Invoke-StorytreeDelivery 'app with spaces' $arch $ops
  Assert ($answer.state -eq 'ready') 'repeat ready'
  Assert (($script:Calls -join ',') -eq "probe:$arch,finish,path") 'repeat must not download or reinstall'
}
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
Write-Output 'delivery bootstrap PASS'
