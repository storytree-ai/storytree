# Reads a trial project's plan back with storytree's installed command, run over SSH after the journey:
# the tree, the stories, capabilities, contracts, arcs and increments, every write to each contract's reported
# health with the state it stored (`library history --fields`), who holds anything now, and the activity log. Each answer goes to its own file for observe.mjs.
# Usage: powershell -File read.ps1 <project folder> <outDir>
param([string]$Folder, [string]$Out)
$ErrorActionPreference = 'Continue'
New-Item -ItemType Directory -Force $Out | Out-Null
Set-Location -LiteralPath $Folder
function St([string]$File, [string[]]$Words) { & storytree @Words *> "$Out\$File" }
St 'doctor.txt' @('doctor')
St 'tree.txt' @('tree')
St 'board.txt' @('noticeboard')
St 'log.txt' @('noticeboard', 'log', '--limit', '100000')
foreach ($kind in 'story', 'capability', 'contract', 'increment') { St "list-$kind.txt" @('library', 'list', $kind) }
St 'arcs.txt' @('arc', 'list')
foreach ($id in (Select-String -Path "$Out\arcs.txt" -Pattern '\b(arc_[0-9a-f]+)\b' -AllMatches | ForEach-Object { $_.Matches } | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique)) {
  St "arc-$id.txt" @('arc', 'show', $id)
}
foreach ($id in (Select-String -Path "$Out\list-increment.txt" -Pattern '^\s+(increment_[0-9a-f]+)' | ForEach-Object { $_.Matches[0].Groups[1].Value })) {
  St "read-$id.txt" @('library', 'read', $id)
}
foreach ($id in (Select-String -Path "$Out\list-contract.txt" -Pattern '^\s+(contract_[0-9a-f]+)' | ForEach-Object { $_.Matches[0].Groups[1].Value })) {
  St "history-$id.txt" @('library', 'history', "health_${id}_reported", '--fields')
}
'done' | Set-Content "$Out\done.txt"
