$r = "$HOME\st-retest\rpf"
New-Item -ItemType Directory -Force $r | Out-Null
Start-Transcript -LiteralPath "$r\install-1.transcript.txt"
$f = "$HOME\PF Project Folder"
New-Item -ItemType Directory -Force $f | Out-Null
Set-Location -LiteralPath $f
Get-Location
$t = Get-Date
& ([scriptblock]::Create((Invoke-RestMethod 'https://github.com/storytree-ai/storytree/releases/latest/download/install-storytree.ps1')))
1


"install exit: $LASTEXITCODE; seconds: $([int]((Get-Date) - $t).TotalSeconds); ready at $(Get-Date -Format o)"
"installed version: $((Get-Item "$env:LOCALAPPDATA\Programs\storytree-0.3\storytree-0.3.exe").VersionInfo.ProductVersion)"
"folder items after: $((Get-ChildItem -Force -LiteralPath $f | Select-Object -ExpandProperty Name) -join ', ')"
"marker: $(Get-Content -Raw -LiteralPath "$f\.storytree.json" -EA SilentlyContinue)"
"project choice: $(Get-Content -Raw "$HOME\.storytree\0.3\project-choice.json" -EA SilentlyContinue)"
Stop-Transcript
