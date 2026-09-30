#!/usr/bin/env bash
# Prepare and run each labelled trial in turn (label's first letter is its arm), keeping its transcript and
# ordered actions. After each: stop any Codex command runner it left behind, and check that nothing outside
# the trial's own home was pointed at an arm (the user's `storytree` command, Claude Code's settings).
# Run from the evidence folder. Usage: run-all.sh A1 B1 A2 B2 A3 B3
set -uo pipefail
for label in "$@"; do
  # The app's updater reinstalls its folder at a quiet moment, taking the placed arms with it: place them again.
  ssh winlap "powershell -NoProfile -ExecutionPolicy Bypass -File st-habits\\place-arms.ps1" 2>/dev/null > /dev/null
  placed=$(ssh winlap "powershell -NoProfile -Command \"(Test-Path \$env:LOCALAPPDATA\Programs\storytree-0.3\resources\agent-tools\storytree-mcp-armA.mjs) -and (Test-Path \$env:LOCALAPPDATA\Programs\storytree-0.3\resources\agent-tools\storytree-mcp-armB.mjs)\"" 2>/dev/null | tr -d '\r')
  [ "$placed" != "True" ] && { echo "STOPPED: the arms are not in place"; exit 1; }
  before=$(ssh winlap "storytree --version" 2>/dev/null | tr -d '\r')
  ssh winlap "powershell -NoProfile -ExecutionPolicy Bypass -File st-habits\\prep.ps1 $label ${label:0:1}" 2>/dev/null > "prep-$label.txt"
  LABEL=$label ./harness/lap.sh "trial-$label" "${TRIAL:-harness/trial.in.txt}" 25 > /dev/null
  ssh winlap "type st-habits\\trial-$label.stdout.txt" 2>/dev/null > "trial-$label.txt"
  ssh winlap "powershell -NoProfile -ExecutionPolicy Bypass -File st-habits\\calls.ps1 $label" 2>/dev/null > "calls-$label.txt"
  guard=$(ssh winlap "powershell -NoProfile -Command \"Get-Process | Where-Object { \$_.Path -like '*st-habits*' } | Stop-Process -Force; @(Select-String -Path C:\Users\mickh\.claude\settings.json,C:\Users\mickh\.storytree\0.3\bin\storytree.cmd -Pattern 'st-habits|-arm[AB]').Count\"" 2>/dev/null | tr -d '\r')
  after=$(ssh winlap "storytree --version" 2>/dev/null | tr -d '\r')
  [ "$before" != "$after" ] && echo "VOID $label: the app updated during it ($before -> $after)" >> void.txt
  echo "$label done: $(grep -c . "calls-$label.txt") actions; arm references outside the trial: $guard; $before -> $after"
  [ "$guard" != "0" ] && { echo "STOPPED: something outside the trial points at an arm"; exit 1; }
done
