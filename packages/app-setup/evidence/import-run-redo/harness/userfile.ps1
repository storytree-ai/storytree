# Step 6, second part: the user adds a new file to their viewer and commits it, outside any storytree session; the map's
# count of the mapped island's files is read before and after, with no import in between.
param([string]$P = 'a')
$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
$v = "$HOME\st-redo\$P\viewer-for-reddit"
$st = "$HOME\st-redo\st.ps1"
function count($label) { "=== $label $(Get-Date -Format o) HEAD $(git -C $v rev-parse --short HEAD)"; & $st $P map --select story:@gregrickaby/viewer-for-reddit 2>&1 | Select-String -Pattern 'Mapped|Depth 1' | ForEach-Object { "  $($_.Line.Trim())" } }
count 'before'
Set-Content -LiteralPath "$v\lib\owner-note.ts" -Value "/** A note from the owner of this copy. */`nexport const OWNER_NOTE = 'I run it on my old laptop.'"
git -C $v add lib/owner-note.ts
git -C $v -c user.name=winlap-user -c user.email=user@example.invalid commit -q -m "lib: the owner's note" -- lib/owner-note.ts
"committed: $(git -C $v log --oneline -1)"
count 'after, no import'
& $st $P map --select file:../viewer-for-reddit/lib/owner-note.ts 2>&1 | Select-Object -First 6
