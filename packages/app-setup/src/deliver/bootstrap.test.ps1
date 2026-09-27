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
Write-Output 'delivery bootstrap PASS'
