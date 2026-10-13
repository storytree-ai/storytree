# Step 6: the user changes their own viewer outside any storytree session (a README line, committed), and the state
# storytree holds for it is printed before and after: the mapped story's record and the map's count of its files.
param([string]$P = 'a')
$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
$v = "$HOME\st-redo\$P\viewer-for-reddit"
$st = "$HOME\st-redo\st.ps1"
function state($label) {
  "=== $label $(Get-Date -Format o)"
  "viewer HEAD: $(git -C $v rev-parse --short HEAD)"
  & $st $P library read story_4777fb1c7400 2>&1 | Select-String -Pattern 'mapped|commit|from|Updated' | ForEach-Object { "  $($_.Line.Trim())" }
  & $st $P map --select story:@gregrickaby/viewer-for-reddit 2>&1 | Select-String -Pattern 'Mapped|file' | ForEach-Object { "  $($_.Line.Trim())" }
}
state 'before'
Add-Content -LiteralPath "$v\README.md" -Value "`nA note from the owner of this copy: I run it on my old laptop."
git -C $v -c user.name=winlap-user -c user.email=user@example.invalid commit -q -m "README: a note from this copy's owner" -- README.md
"committed: $(git -C $v log --oneline -1)"
Start-Sleep 20
state 'after'
