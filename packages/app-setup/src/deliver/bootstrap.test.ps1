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
