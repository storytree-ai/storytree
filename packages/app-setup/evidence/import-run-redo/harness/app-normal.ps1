# Restart the app normally, closing the DevTools port.
& "$env:LOCALAPPDATA\Programs\storytree-0.3\resources\agent-tools\node.exe" "$env:LOCALAPPDATA\Programs\storytree-0.3\resources\agent-tools\storytree.mjs" app quit
Start-Sleep 6
Start-Process -FilePath "$env:LOCALAPPDATA\Programs\storytree-0.3\storytree-0.3.exe"
Start-Sleep 25
try { Invoke-WebRequest -UseBasicParsing http://127.0.0.1:9222/json -TimeoutSec 3 | Out-Null; 'debug port STILL OPEN' } catch { 'debug port closed' }
