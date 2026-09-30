# Live proof of the one-liner's progress on this machine without touching an installed storytree or its home:
# the real release download and stage messages run into a throwaway folder; a 15-second stand-in process takes
# the place of the NSIS installer, whose one-click install would replace the storytree-0.3 already installed here.
# Run it in its own console window: powershell.exe -NoProfile -File live-proof.ps1 -Out <dir>
param([string]$Out)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/../../../src/deliver/install.ps1" -LibraryOnly
New-Item -ItemType Directory -Force $Out | Out-Null
$snaps = Join-Path $Out "screen-ps$($PSVersionTable.PSVersion.Major).txt"
Set-Content -LiteralPath $snaps -Value "PowerShell $($PSVersionTable.PSVersion): top of the console window as the user saw it" -Encoding utf8
$script:lastSnap = [DateTime]::MinValue
function Write-Progress {
  # Pass through to the real cmdlet, then copy the rows it drew (the progress pane) every two seconds.
  Microsoft.PowerShell.Utility\Write-Progress @args
  if (((Get-Date) - $script:lastSnap).TotalSeconds -lt 2) { return }
  $script:lastSnap = Get-Date
  $ui = $Host.UI.RawUI
  $top = $ui.WindowPosition.Y
  $cells = $ui.GetBufferContents((New-Object Management.Automation.Host.Rectangle 0, $top, ($ui.WindowSize.Width - 1), ($top + 6)))
  $rows = foreach ($y in 0..($cells.GetLength(0) - 1)) { -join (0..($cells.GetLength(1) - 1) | ForEach-Object { $cells[$y, $_].Character }) }
  Add-Content -LiteralPath $snaps -Value ("--- {0:HH:mm:ss}" -f (Get-Date)) -Encoding utf8
  Add-Content -LiteralPath $snaps -Value ($rows | ForEach-Object { $_.TrimEnd() }) -Encoding utf8
}
$work = Join-Path ([IO.Path]::GetTempPath()) ('st-progress-proof-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory $work | Out-Null
Start-Transcript -LiteralPath (Join-Path $Out "transcript-ps$($PSVersionTable.PSVersion.Major).txt") | Out-Null
$times = @{}
try {
  $script:installed = $false
  $answer = Invoke-StorytreeDelivery (Join-Path $work 'app') 'x64' @{
    Stage = { param($Step) Write-Host $StorytreeStages[$Step] }
    Probe = { param($Dir, $Arch) return $script:installed }
    Download = {
      param($Arch)
      $clock = [Diagnostics.Stopwatch]::StartNew()
      [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
      $release = Invoke-RestMethod 'https://api.github.com/repos/storytree-ai/storytree/releases/latest' -Headers @{ 'User-Agent' = 'storytree-delivery' }
      $manifest = Invoke-RestMethod (Get-StorytreeAsset $release 'storytree-delivery.json')
      $asset = Select-StorytreeInstaller $release $manifest $Arch
      $file = Join-Path $work $asset.name
      Save-StorytreeFile $asset.url "$file.download"
      Assert-StorytreeDownload "$file.download" $asset.sha256
      Write-Host "Checksum matches release $($release.tag_name)."
      $times.download = $clock.Elapsed.TotalSeconds
      return $file
    }
    Install = {
      param($Installer, $Dir)
      $process = Start-Process -FilePath powershell.exe -ArgumentList '-NoProfile -Command Start-Sleep -Seconds 15' -PassThru -WindowStyle Hidden
      $null = $process.Handle
      $took = Wait-StorytreeProcess $process {
        param($Elapsed)
        Write-Progress -Activity 'Installing storytree' -Status ('Still installing: {0:mm\:ss} so far. This may take a few minutes.' -f $Elapsed)
      }
      Write-Progress -Activity 'Installing storytree' -Completed
      Write-Host ('Installed in {0:N0} s. (stand-in process, exit code {1})' -f $took.TotalSeconds, $process.ExitCode)
      $script:installed = $true
    }
    Finish = { param($Dir, $Arch) return @{ command = @{ status = 'installed' } } }
    Path = { param($Report) }
  }
  Write-Host "Result: $($answer.state); download stage $([math]::Round($times.download, 1)) s."
} finally {
  Stop-Transcript | Out-Null
  Remove-Item -LiteralPath $work -Recurse -Force
}
