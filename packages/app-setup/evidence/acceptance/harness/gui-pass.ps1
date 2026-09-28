$d = "$HOME\st-evidence"
$shots = "$d\shots"
Remove-Item "$shots\*" -EA SilentlyContinue
New-Item -ItemType Directory -Force $shots | Out-Null
$node = 'C:\Program Files\nodejs\node.exe'
function Screen([string]$name) {
  $f = "$d\screen-$name.txt"
  Set-Content -Encoding ascii $f "& '$d\screen.ps1' -Out '$shots\$name.png'"
  & "$d\run-interactive.ps1" "screen-$name" $f 2 | Out-Null
  "screen $name"
}
function Cdp { & $node "$d\cdp.mjs" $shots @args }
$state = "$d\state.js"
Set-Content -Encoding ascii $state 'document.body.dataset.state + " project=" + document.body.dataset.project + " menu=" + getComputedStyle(document.getElementById("app-menu")).display'

Cdp "evalfile:$state" "shot:app-1-first-view"
# Projects: gear, Projects, choose claude-trial-2 from the select with the keyboard-free select API through a real focus + change.
Cdp "mouse:App menu" "shot:app-2-menu-open" "mouse:Projects" "shot:app-3-projects" "evalfile:$state"
Cdp "evalfile:$d\p1sel.js" "shot:app-4-forest-claude-trial-2" "evalfile:$state"
Cdp "evalfile:$d\p2sel.js" "shot:app-5-forest-codex-trial" "evalfile:$state"
# Help
Cdp "mouse:App menu" "mouse:Help" "evalfile:$state" "shot:app-6-help-guide"
Screen 'desktop-1-help-open'
$exe = "$env:LOCALAPPDATA\Programs\storytree-0.3\storytree-0.3.exe"
New-NetFirewallRule -DisplayName 'st-acceptance-offline' -Direction Outbound -Program $exe -Action Block | Out-Null
"firewall block on: " + [bool](Get-NetFirewallRule -DisplayName 'st-acceptance-offline' -EA SilentlyContinue)
Cdp "mouse:License" "wait:2000" "evalfile:$d\licread.js" "shot:app-7-license-offline"
Remove-NetFirewallRule -DisplayName 'st-acceptance-offline'
"firewall block removed: " + (-not (Get-NetFirewallRule -DisplayName 'st-acceptance-offline' -EA SilentlyContinue))
Cdp "mouse:Send feedback" "mouse:css=[name=title]" "type:Acceptance test draft - please ignore" "mouse:css=[name=body]" "type:Written by the Windows acceptance run on a test laptop. Not submitted." "shot:app-8-feedback-form" "mouse:Open GitHub draft" "wait:4000" "evalfile:$d\fbstatus.js" "shot:app-9-feedback-opened"
Start-Sleep 5
Screen 'desktop-2-after-feedback'
