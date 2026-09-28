#!/usr/bin/env bash
# From the Linux box: run a harness input file in the laptop's desktop session and print its output.
# Usage: ROUND=<n> [LABEL=<x>] lap.sh <name> <input-template> [minutes]
set -euo pipefail
name=$1; tpl=$2; mins=${3:-20}
tmp=$(mktemp); sed -e "s/ROUND/${ROUND}/g" -e "s/LABEL/${LABEL:-x}/g" "$tpl" > "$tmp"
scp -q "$tmp" "winlap:st-retest/$name.in.txt"; rm -f "$tmp"
ssh winlap "powershell -NoProfile -ExecutionPolicy Bypass -File st-retest\\run-interactive.ps1 $name C:\\Users\\mickh\\st-retest\\$name.in.txt $mins"
ssh winlap "type st-retest\\$name.stdout.txt"
