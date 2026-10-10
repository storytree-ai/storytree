#!/usr/bin/env bash
# Run a trial input file in the laptop owner's desktop session (Codex cannot run commands from the elevated SSH login).
# Usage: LABEL=<x> lap.sh <name> <input-template> [minutes]
set -euo pipefail
name=$1; tpl=$2; mins=${3:-25}
tmp=$(mktemp); sed -e "s/LABEL/${LABEL}/g" "$tpl" > "$tmp"
scp -q "$tmp" "winlap:st-habits/$name.in.txt"; rm -f "$tmp"
input='C:\Users\mickh\st-habits\'"$name"'.in.txt'
ssh winlap "powershell -NoProfile -ExecutionPolicy Bypass -File st-habits\\run-interactive.ps1 $name $input $mins" 2>/dev/null
ssh winlap "type st-habits\\$name.stdout.txt" 2>/dev/null
