param([string]$Out)
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
$url = 'https://github.com/storytree-ai/storytree/releases/download/v0.3.337/storytree-0.3-0.3.337-setup.exe'
$dir = Join-Path $env:TEMP ('st-measure-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory $dir | Out-Null
function Log($m) { "$(Get-Date -Format o) PS $($PSVersionTable.PSVersion) $m" | Tee-Object -FilePath $Out -Append }
try {
  # A: plain stream copy, no progress
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $req = [Net.HttpWebRequest]::Create($url); $req.UserAgent = 'storytree-measure'
  $res = $req.GetResponse(); $in = $res.GetResponseStream(); $fs = [IO.File]::Create("$dir\a.exe")
  $buf = New-Object byte[] 1048576; $n = 0
  while (($r = $in.Read($buf, 0, $buf.Length)) -gt 0) { $fs.Write($buf, 0, $r); $n += $r }
  $fs.Close(); $in.Close(); $res.Close()
  Log "stream-copy bytes=$n seconds=$([math]::Round($sw.Elapsed.TotalSeconds,1))"
  Remove-Item "$dir\a.exe"
  # B: Invoke-WebRequest with progress silenced
  $ProgressPreference = 'SilentlyContinue'
  $sw.Restart(); Invoke-WebRequest $url -UseBasicParsing -OutFile "$dir\b.exe"
  Log "iwr-silent seconds=$([math]::Round($sw.Elapsed.TotalSeconds,1))"
  Remove-Item "$dir\b.exe"
  # C: Invoke-WebRequest with its default progress (as install.ps1 runs today)
  $ProgressPreference = 'Continue'
  $sw.Restart(); Invoke-WebRequest $url -UseBasicParsing -OutFile "$dir\c.exe"
  Log "iwr-progress seconds=$([math]::Round($sw.Elapsed.TotalSeconds,1))"
} finally { Remove-Item $dir -Recurse -Force }
