#!/usr/bin/env bash
# Prepare and run one trial in the laptop owner's desktop session, keeping the Codex transcript and the
# reviewer's records. Run from the evidence folder. Usage: lap.sh <label> [arm]
set -uo pipefail
label=$1; arm=${2:-}
busy=$(ssh -n winlap "tasklist /fo csv /nh" 2>/dev/null | grep -ciE '"(codex|claude)[^"]*\.exe"')
[ "$busy" != "0" ] && { echo "BUSY: another codex or claude is running on the laptop"; exit 2; }
before=$(ssh -n winlap "storytree --version" 2>/dev/null | tr -d '\r')
ssh -n winlap "powershell -NoProfile -ExecutionPolicy Bypass -File st-second\\prep.ps1 $label $arm" 2>/dev/null > "runs/prep-$label.txt"
tmp=$(mktemp); sed -e "s/LABEL/$label/g" harness/trial.in.txt > "$tmp"
scp -q "$tmp" "winlap:st-second/trial-$label.in.txt"; rm -f "$tmp"
ssh -n winlap "powershell -NoProfile -ExecutionPolicy Bypass -File st-second\\run-interactive.ps1 trial-$label C:\\Users\\mickh\\st-second\\trial-$label.in.txt 20" 2>/dev/null
ssh -n winlap "type st-second\\trial-$label.stdout.txt" 2>/dev/null > "runs/trial-$label.jsonl"
ssh -n winlap "powershell -NoProfile -ExecutionPolicy Bypass -File st-second\\reviews.ps1 $label" 2>/dev/null > "runs/reviews-$label.jsonl"
after=$(ssh -n winlap "storytree --version" 2>/dev/null | tr -d '\r')
[ "$before" != "$after" ] && echo "VOID $label: the app updated during it ($before -> $after)"
node ../first-build/harness/csum.mjs "runs/trial-$label.jsonl" > "runs/trial-$label.txt"
echo "$label ($before, arm '$arm'):"; grep -E 'check_setup|set_up_project' "runs/trial-$label.txt"
