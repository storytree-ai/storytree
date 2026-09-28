#!/usr/bin/env bash
# Fetch a claude turn's stream-json from the laptop, keep the raw file outside the repo (it carries
# account-specific plugin paths), and write the rendered transcript, without its init lines, to the round's folder.
# Usage: ROUND=<n> fetch.sh <out> [subdir]
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd); out=$1; sub=${2:-}
raw=~/storytree-lanes/winretest-raw/round-$ROUND/$sub; mkdir -p "$raw"
dest="$here/../round-$ROUND/$sub"; mkdir -p "$dest"
scp -q "winlap:st-retest/r$ROUND/$out.jsonl" "$raw/"
python3 "$here/render.py" "$raw/$out.jsonl" | grep -v '^\[init\]\|thinking_tokens' > "$dest/$out.txt" || true
