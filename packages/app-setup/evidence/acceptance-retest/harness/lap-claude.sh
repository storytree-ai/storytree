#!/usr/bin/env bash
# From the Linux box: run one `claude -p` turn in a folder under the laptop user's home, in the desktop session,
# with stdin closed, and save its stream-json transcript as st-retest\r<ROUND>\<out>.jsonl.
# Usage: ROUND=<n> lap-claude.sh <folder-name> <out> <prompt> [extra claude flags...]
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
folder=$1; out=$2; prompt=$3; shift 3; extra="$*"
cmdf=$(mktemp); psf=$(mktemp)
printf '@cd /d "%%USERPROFILE%%\\%s"\r\n@claude -p "%s" %s --allowedTools mcp__storytree Edit Write Bash PowerShell --output-format stream-json --verbose < NUL > "%%USERPROFILE%%\\st-retest\\r%s\\%s.jsonl" 2>&1\r\n' \
  "$folder" "$prompt" "$extra" "$ROUND" "$out" > "$cmdf"
ssh winlap "if not exist st-retest\\r$ROUND mkdir st-retest\\r$ROUND"
scp -q "$cmdf" "winlap:st-retest/r$ROUND/$out.cmd"
cat > "$psf" <<PS
New-Item -ItemType Directory -Force "\$HOME\\${folder}" | Out-Null
"folder before: " + ((Get-ChildItem -Force -LiteralPath "\$HOME\\${folder}" | Select-Object -ExpandProperty Name) -join ', ')
& cmd /c "\$HOME\\st-retest\\r${ROUND}\\${out}.cmd"
"claude exit: \$LASTEXITCODE"
"folder after: " + ((Get-ChildItem -Force -LiteralPath "\$HOME\\${folder}" | Select-Object -ExpandProperty Name) -join ', ')
PS
ROUND=$ROUND "$here/lap.sh" "claude-$out" "$psf" 15
rm -f "$cmdf" "$psf"
