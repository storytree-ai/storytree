# Put each arm's tool server beside the installed tools (storytree-mcp-arm<X>.mjs, and its chunks in the
# installed chunks folder), so the hook script and the storytree command it finds beside it are the
# installed ones, as for a real user: a tool server anywhere else registers ITS OWN folder's hooks and
# command for the whole machine. Every file added is listed in added.txt; remove-arms.ps1 takes out exactly those.
$tools = "$env:LOCALAPPDATA\Programs\storytree-0.3\resources\agent-tools"
$manifest = "$HOME\st-habits\added.txt"
foreach ($arm in 'A', 'B') {
  $from = "$HOME\st-habits\arm$arm"
  $to = "$tools\storytree-mcp-arm$arm.mjs"
  Copy-Item "$from\storytree-mcp.mjs" $to
  Add-Content $manifest $to
  foreach ($chunk in Get-ChildItem "$from\chunks" -File) {
    $target = "$tools\chunks\$($chunk.Name)"
    if (-not (Test-Path $target)) { Copy-Item $chunk.FullName $target; Add-Content $manifest $target }
  }
}
"added $(@(Get-Content $manifest).Count) files"
