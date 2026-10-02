# Put the built tool server (st-second\armF: storytree-mcp.mjs and its chunks) beside the installed tools as
# storytree-mcp-armF.mjs, so the hook script and storytree command it finds beside it are the installed ones
# (process_81a7122f6849 step 12). Every file added is listed in added.txt; remove-arm.ps1 takes out exactly those.
$tools = "$env:LOCALAPPDATA\Programs\storytree-0.3\resources\agent-tools"
$manifest = "$HOME\st-second\added.txt"
$from = "$HOME\st-second\armF"
$to = "$tools\storytree-mcp-armF.mjs"
Copy-Item "$from\storytree-mcp.mjs" $to
Add-Content $manifest $to
foreach ($chunk in Get-ChildItem "$from\chunks" -File) {
  $target = "$tools\chunks\$($chunk.Name)"
  if (-not (Test-Path $target)) { Copy-Item $chunk.FullName $target; Add-Content $manifest $target }
}
"added $(@(Get-Content $manifest).Count) files"
