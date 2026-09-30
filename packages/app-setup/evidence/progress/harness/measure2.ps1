param([string]$Out, [string]$Script)
$ErrorActionPreference = 'Stop'
. $Script -LibraryOnly
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
$url = 'https://github.com/storytree-ai/storytree/releases/download/v0.3.337/storytree-0.3-0.3.337-setup.exe'
$dir = Join-Path $env:TEMP ('st-measure-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory $dir | Out-Null
function Log($m) { "$(Get-Date -Format o) PS $($PSVersionTable.PSVersion) $m" | Tee-Object -FilePath $Out -Append }
try {
  foreach ($round in 1, 2) {
    $sw = [Diagnostics.Stopwatch]::StartNew()
    Save-StorytreeFile $url "$dir\s.exe"
    Log "round $round Save-StorytreeFile (progress bar on) seconds=$([math]::Round($sw.Elapsed.TotalSeconds,1)) bytes=$((Get-Item "$dir\s.exe").Length) sha256=$((Get-FileHash "$dir\s.exe").Hash)"
    Remove-Item "$dir\s.exe"
    $ProgressPreference = 'SilentlyContinue'
    $sw.Restart(); Invoke-WebRequest $url -UseBasicParsing -OutFile "$dir\b.exe"
    Log "round $round iwr-silent seconds=$([math]::Round($sw.Elapsed.TotalSeconds,1))"
    $ProgressPreference = 'Continue'
    Remove-Item "$dir\b.exe"
  }
} finally { Remove-Item $dir -Recurse -Force }
