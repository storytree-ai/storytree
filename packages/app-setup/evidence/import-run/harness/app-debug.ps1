# Restart the app in the desktop session with its DevTools port, between turns only.
& "$env:LOCALAPPDATA\Programs\storytree-0.3\resources\agent-tools\node.exe" "$env:LOCALAPPDATA\Programs\storytree-0.3\resources\agent-tools\storytree.mjs" app quit
Start-Sleep 6
Start-Process -FilePath "$env:LOCALAPPDATA\Programs\storytree-0.3\storytree-0.3.exe" -ArgumentList '--remote-debugging-port=9222'
Start-Sleep 30
try { "debug targets: $(((Invoke-WebRequest -UseBasicParsing http://127.0.0.1:9222/json).Content | ConvertFrom-Json | Where-Object type -eq page).title)" } catch { "debug port: $($_.Exception.Message)" }
