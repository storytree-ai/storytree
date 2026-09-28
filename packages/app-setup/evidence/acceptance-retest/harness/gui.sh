#!/usr/bin/env bash
# From the Linux box: the app-screen part of a round (Projects picker, help, offline license, feedback draft,
# updates), over DevTools with the app restarted on a debugging port, then restarted normally.
# Usage: ROUND=<n> gui.sh <projectA> <projectB>
set -uo pipefail
here=$(cd "$(dirname "$0")" && pwd); r="C:\\Users\\mickh\\st-retest\\r$ROUND"; out="$r\\shots"
cdp() { ssh winlap "C:\\Users\\mickh\\st-retest\\cdp.cmd $out $*"; }
ROUND=$ROUND "$here/lap.sh" app-debug "$here/app-debug.txt" 3
ssh winlap "if not exist $out mkdir $out"
for i in 1 2 3 4 5 6; do ssh winlap "curl -s -m 3 http://127.0.0.1:9222/json" | grep -q webSocketDebuggerUrl && break; sleep 10; done
cdp evalfile:C:\\Users\\mickh\\st-retest\\steps.js shot:app-1-first-view wait:3000 "\"mouse:App menu\"" wait:1500 mouse:Projects wait:1500 shot:app-2-projects "\"eval:[...document.querySelectorAll('select#project option')].map(o=>o.value).join(',')\""
cdp evalfile:C:\\Users\\mickh\\st-retest\\steps.js "\"eval:st.project('$1')\"" shot:app-3-forest-$1 "\"eval:st.project('$2')\"" shot:app-4-forest-$2 "\"eval:document.title\""
cdp "\"mouse:App menu\"" wait:1000 mouse:Help wait:1000 "\"mouse:First-run guide\"" wait:800 shot:app-5-help-guide
ssh winlap "powershell -NoProfile -Command \"New-NetFirewallRule -DisplayName st-retest-offline -Direction Outbound -Program \$env:LOCALAPPDATA\\Programs\\storytree-0.3\\storytree-0.3.exe -Action Block | Out-Null; 'block on: ' + [bool](Get-NetFirewallRule -DisplayName st-retest-offline -EA SilentlyContinue)\""
cdp mouse:License wait:2500 evalfile:C:\\Users\\mickh\\st-retest\\licread.js shot:app-6-license-offline
ssh winlap "powershell -NoProfile -Command \"Remove-NetFirewallRule -DisplayName st-retest-offline; 'block removed: ' + (-not (Get-NetFirewallRule -DisplayName st-retest-offline -EA SilentlyContinue))\""
cdp "\"mouse:Send feedback\"" wait:800 mouse:css=[name=title] "\"type:Retest draft - please ignore\"" mouse:css=[name=body] "\"type:Written by the Windows retest on a test laptop. Not submitted.\"" shot:app-7-feedback-form "\"mouse:Open GitHub draft\"" wait:4000 evalfile:C:\\Users\\mickh\\st-retest\\fbstatus.js shot:app-8-feedback-opened
cdp mouse:Updates wait:800 "\"mouse:Check for updates\"" wait:6000 "\"eval:document.querySelector('#app-menu').innerText.split('Updates').pop().trim().replace(/\\\\n+/g,' | ')\"" shot:app-9-updates
ROUND=$ROUND "$here/lap.sh" app-normal "$here/app-normal.txt" 3
