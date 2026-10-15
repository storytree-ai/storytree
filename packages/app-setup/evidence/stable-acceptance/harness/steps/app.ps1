# As the fresh user: close the app and open it again with a DevTools port on 127.0.0.1 for the run. `storytree app
# quit` cannot reach an app in a task's session, so it stops every process under the install folder, the
# installer's own rule (process_81a7122f6849, step 21).
$app = "$env:LOCALAPPDATA\Programs\storytree-0.3"
Get-Process | Where-Object { $_.Path -like "$app\*" } | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Process -FilePath "$app\storytree-0.3.exe" -ArgumentList '--remote-debugging-port=@PORT@'
$deadline = (Get-Date).AddMinutes(2)
do { Start-Sleep 3; try { $page = (Invoke-RestMethod 'http://127.0.0.1:@PORT@/json') | Where-Object type -eq 'page' } catch { $page = $null } } while (-not $page -and (Get-Date) -lt $deadline)
"app: $((Get-Item "$app\storytree-0.3.exe").VersionInfo.ProductVersion); page: $(if ($page) { $page[0].url } else { 'none' })"
