# As the fresh user: steps on the app's screens through DevTools (cdp.mjs), run by the app's own Node.
$tools = "$env:LOCALAPPDATA\Programs\storytree-0.3\resources\agent-tools"
$env:CDP_PORT = '@PORT@'
# One step a line in cdp-steps.txt; text to type goes in a file (typefile:), as PowerShell 5.1 strips quotes from arguments.
$steps = @(Get-Content -Encoding UTF8 "$PSScriptRoot\cdp-steps.txt" | Where-Object { $_ })
& "$tools\node.exe" "$PSScriptRoot\cdp.mjs" "$PSScriptRoot\ev\shots" @steps 2>&1
