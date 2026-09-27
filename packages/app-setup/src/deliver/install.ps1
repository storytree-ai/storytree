# Windows PowerShell 5.1 and PowerShell 7. No Node/npm or checkout prerequisite.
param([switch]$LibraryOnly)
$ErrorActionPreference = 'Stop'

function Get-StorytreeArchitecture([string]$ProcessArchitecture, [string]$NativeArchitecture) {
  $native = if ($NativeArchitecture) { $NativeArchitecture } else { $ProcessArchitecture }
  switch ($native.ToUpperInvariant()) {
    'AMD64' { return 'x64' }
    'ARM64' { return 'arm64' }
    default { throw "unsupported Windows architecture '$native'; storytree requires Windows x64 or arm64" }
  }
}

function Add-StorytreePath([string]$Current, [string]$Entry) {
  foreach ($part in ($Current -split ';')) {
    if ($part.Trim().TrimEnd('\') -ieq $Entry.TrimEnd('\')) { return $Current }
  }
  if (-not $Current) { return $Entry }
  return $Current.TrimEnd(';') + ';' + $Entry
}

function Invoke-StorytreeDelivery([string]$InstallDir, [string]$Architecture, [hashtable]$Operations) {
  $step = 'inspect'
  try {
    if (-not (& $Operations.Probe $InstallDir $Architecture)) {
      $step = 'download'
      $installer = & $Operations.Download $Architecture
      $step = 'install'
      & $Operations.Install $installer $InstallDir
      $step = 'verify'
      if (-not (& $Operations.Probe $InstallDir $Architecture)) { throw 'the installed app or its tool payload is incomplete' }
    }
    $step = 'finish'
    $report = & $Operations.Finish $InstallDir $Architecture
    $step = 'path'
    & $Operations.Path $report
    return @{ state = 'ready'; report = $report }
  } catch {
    throw "storytree delivery failed at ${step}: $($_.Exception.Message). Retry: run the same delivery command again. Your projects and agent settings have not been replaced."
  }
}

function Get-StorytreeAsset($Release, [string]$Name) {
  $assets = @($Release.assets | Where-Object { $_.name -ceq $Name })
  if ($assets.Count -ne 1) { throw "release is missing a unique $Name asset" }
  $url = [string]$assets[0].browser_download_url
  $prefix = "https://github.com/storytree-ai/storytree/releases/download/$($Release.tag_name)/"
  if (-not $url.StartsWith($prefix, [StringComparison]::Ordinal)) { throw 'unexpected release asset location' }
  return $url
}

function Select-StorytreeInstaller($Release, $Manifest, [string]$Architecture) {
  if ($Release.draft -or $Release.prerelease -or $Release.tag_name -notmatch '^v\d+\.\d+\.\d+$') { throw 'release is not a stable storytree version' }
  $version = $Release.tag_name.Substring(1)
  if ($Manifest.schema -ne 1 -or $Manifest.version -cne $version -or $Architecture -notin $Manifest.architectures) { throw 'release manifest version or architecture does not match' }
  $name = "storytree-0.3-$version-setup.exe"
  if ($Manifest.installer.name -cne $name -or $Manifest.installer.sha256 -notmatch '^[a-fA-F0-9]{64}$') { throw 'release manifest has no valid installer checksum' }
  return @{ url = (Get-StorytreeAsset $Release $name); sha256 = $Manifest.installer.sha256; name = $name }
}

function Assert-StorytreeDownload([string]$File, [string]$Expected) {
  if ((Get-FileHash -LiteralPath $File -Algorithm SHA256).Hash -ine $Expected) { throw 'download checksum does not match the release; the installer was not run' }
}

if ($LibraryOnly) { return }

$downloadDir = $null
try {
  if ($env:OS -ne 'Windows_NT') { throw 'This command delivers the Windows app. Use a Windows x64 or arm64 terminal.' }
  $architecture = Get-StorytreeArchitecture $env:PROCESSOR_ARCHITECTURE $env:PROCESSOR_ARCHITEW6432
  $storytreeHome = if ($env:STORYTREE_HOME) { [IO.Path]::GetFullPath($env:STORYTREE_HOME) } else { Join-Path $env:USERPROFILE '.storytree\0.3' }
  $installDir = Join-Path $env:LOCALAPPDATA 'Programs\storytree-0.3'
  $recordFile = Join-Path $storytreeHome 'delivery.json'
  if (Test-Path -LiteralPath $recordFile) {
    # Only our record selects a custom installation; app.json may belong to a developer checkout.
    $record = Get-Content -LiteralPath $recordFile -Raw | ConvertFrom-Json
    if ($record.schema -ne 1 -or -not [IO.Path]::IsPathRooted($record.installDir)) { throw 'Invalid delivery record. Keep it for diagnosis and check the installed app before retrying.' }
    $installDir = $record.installDir
  }
  # Expand environment variables without rewriting their original registry text.
  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $env:Path = [Environment]::ExpandEnvironmentVariables("$($env:Path);$machinePath;$userPath")
  $operations = @{
    Probe = {
      param($Dir, $Arch)
      $node = Join-Path $Dir 'resources\agent-tools\node.exe'
      $helper = Join-Path $Dir 'resources\agent-tools\storytree-deliver.mjs'
      if (-not (Test-Path -LiteralPath $node) -or -not (Test-Path -LiteralPath $helper)) {
        if (Test-Path -LiteralPath (Join-Path $Dir 'storytree-0.3.exe')) {
          throw "The app at '$Dir' has no complete bundled tools. Open it and let its ordinary release update finish, or repair it with its downloaded NSIS installer, then retry. Delivery will not overwrite the existing app."
        }
        return $false
      }
      & $node $helper inspect $Dir $Arch 2>$null | Out-Null
      if ($LASTEXITCODE -ne 0) {
        # An existing payload that no longer verifies is not permission to replace it silently.
        throw "The existing installation at '$Dir' failed verification. Open it to check its error or run its downloaded NSIS installer to repair it, then retry."
      }
      return $true
    }
    Download = {
      param($Arch)
      [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
      $headers = @{ 'User-Agent' = 'storytree-delivery'; 'Accept' = 'application/vnd.github+json' }
      $release = Invoke-RestMethod 'https://api.github.com/repos/storytree-ai/storytree/releases/latest' -Headers $headers
      $manifestUrl = Get-StorytreeAsset $release 'storytree-delivery.json'
      $manifest = Invoke-RestMethod $manifestUrl
      $asset = Select-StorytreeInstaller $release $manifest $Arch
      $script:downloadDir = Join-Path ([IO.Path]::GetTempPath()) ('storytree-delivery-' + [Guid]::NewGuid().ToString('N'))
      New-Item -ItemType Directory -Path $script:downloadDir | Out-Null
      $file = Join-Path $script:downloadDir $asset.name
      Write-Host "Downloading storytree for Windows $Arch. The installer is unsigned; Windows may ask whether to run it."
      Invoke-WebRequest $asset.url -UseBasicParsing -OutFile "$file.download"
      Assert-StorytreeDownload "$file.download" $asset.sha256
      Move-Item -LiteralPath "$file.download" -Destination $file
      return $file
    }
    Install = {
      param($Installer, $Dir)
      # NSIS /D must be last and unquoted, even when it contains spaces.
      $process = Start-Process -FilePath $Installer -ArgumentList "/S /D=$Dir" -Wait -PassThru
      if ($process.ExitCode -ne 0) { throw "NSIS installer exited with code $($process.ExitCode)" }
    }
    Finish = {
      param($Dir, $Arch)
      $node = Join-Path $Dir 'resources\agent-tools\node.exe'
      $helper = Join-Path $Dir 'resources\agent-tools\storytree-deliver.mjs'
      $result = & $node $helper finish $Dir $Arch
      if ($LASTEXITCODE -ne 0) { throw 'The app could not be opened or its database did not become ready. Read the app error above.' }
      return ($result | ConvertFrom-Json)
    }
    Path = {
      param($Report)
      if ($Report.command.status -eq 'conflict') { return }
      $entry = [string]$Report.command.pathEntry
      $current = [Environment]::GetEnvironmentVariable('Path', 'User')
      $next = Add-StorytreePath $current $entry
      if ($next -cne $current) {
        [Environment]::SetEnvironmentVariable('Path', $next, 'User')
        # Notify Explorer so a newly opened terminal inherits the persisted PATH.
        if (-not ('StorytreeDelivery.Environment' -as [type])) {
          Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace StorytreeDelivery {
  public static class Environment {
    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    public static extern IntPtr SendMessageTimeout(IntPtr hwnd, uint msg, UIntPtr wparam, string lparam, uint flags, uint timeout, out UIntPtr result);
  }
}
'@
        }
        $result = [UIntPtr]::Zero
        [StorytreeDelivery.Environment]::SendMessageTimeout([IntPtr]0xffff, 0x1a, [UIntPtr]::Zero, 'Environment', 2, 5000, [ref]$result) | Out-Null
      }
      $env:Path = Add-StorytreePath $env:Path $entry
    }
  }
  $answer = Invoke-StorytreeDelivery $installDir $architecture $operations
  Write-Host 'storytree is installed; its app is open and its database is ready. Delivery did not create a project.'
  if ($answer.report.command.status -eq 'conflict') {
    Write-Host "An existing storytree command was preserved: $($answer.report.command.conflict)"
    Write-Host "Run this installation explicitly: & '$($answer.report.tools.node)' '$($answer.report.tools.cli)'"
  } else {
    Write-Host 'The storytree command is available in a fresh Windows terminal.'
  }
  Write-Host 'Open Help > First-run guide to connect your already installed and signed-in agent. Delivery alone does not verify an agent connection.'
} catch {
  Write-Error "$_ Retry: run the same delivery command again after resolving the named step."
  exit 1
} finally {
  if ($script:downloadDir -and (Test-Path -LiteralPath $script:downloadDir)) { Remove-Item -LiteralPath $script:downloadDir -Recurse -Force }
}
