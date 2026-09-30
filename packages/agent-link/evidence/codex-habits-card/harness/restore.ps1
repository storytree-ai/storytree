# Leave the laptop as found: stop any trial process, take the trial projects off this machine's list, take out
# exactly the files placed beside the installed tools, and delete the trial folders and Codex homes (which
# hold copies of the Codex sign-in). Then say what is left.
Get-Process | Where-Object { $_.Path -like '*st-habits*' } | Stop-Process -Force
$folders = Get-ChildItem $HOME -Directory | Where-Object { $_.Name -like 'HB Trial *' }
foreach ($folder in $folders) {
  $label = $folder.Name.Substring('HB Trial '.Length).ToLower()
  & "$HOME\.storytree\0.3\bin\storytree.cmd" project remove "hb-$label" 2>&1 | Select-Object -First 1
}
& "$HOME\st-habits\remove-arms.ps1"
$folders | Remove-Item -Recurse -Force
Remove-Item -Recurse -Force "$HOME\st-habits"
"trial folders left: $(@(Get-ChildItem $HOME -Directory | Where-Object { $_.Name -like 'HB Trial *' }).Count); st-habits: $(Test-Path "$HOME\st-habits")"
"arm files beside the installed tools: $(@(Get-ChildItem "$env:LOCALAPPDATA\Programs\storytree-0.3\resources\agent-tools" -Filter 'storytree-mcp-arm*').Count)"
"arm references in Claude Code settings or the storytree command: $(@(Select-String -Path "$HOME\.claude\settings.json","$HOME\.storytree\0.3\bin\storytree.cmd" -Pattern 'st-habits|-arm[AB]').Count)"
"scheduled st- tasks: $(@(schtasks /query /fo csv | Select-String 'st-').Count)"
