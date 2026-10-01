#!/bin/bash
# cdp.sh step... : drive the laptop app over DevTools (from SSH; the debug port is local to the laptop), shots land in st-firstbuild\shots and are copied back
args=""; for a in "$@"; do args="$args \"$a\""; done
"$TEMP/fb/w.sh" "%LOCALAPPDATA%\Programs\storytree-0.3\resources\agent-tools\node.exe C:\Users\mickh\st-firstbuild\cdp.mjs C:\Users\mickh\st-firstbuild\shots $args"
for a in "$@"; do case "$a" in shot:*) n="${a#shot:}"; scp -q -o BatchMode=yes "winlap:st-firstbuild/shots/$n.png" "$TEMP/fb/ev/shots/$n.png" 2>/dev/null && echo "$TEMP/fb/ev/shots/$n.png";; esac; done
