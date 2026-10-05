#!/usr/bin/env bash
# Prints each turn's cost, seconds and final answer from its saved transcript (PowerShell wrote it as UTF-16).
# Usage: answer.sh <turn>...
for t in "$@"; do
  echo "=== $t"
  iconv -f UTF-16LE -t UTF-8 "${SHOP_PRIVATE:-$HOME/storytree-lanes/shop-guarded-private}/$t.jsonl" | tr -d '\r' | sed 's/^\xef\xbb\xbf//' | grep '"type":"result"' | tail -1 |
    python3 -c 'import sys,json; o=json.loads(sys.stdin.read()); print("cost", o["total_cost_usd"], "ms", o["duration_ms"]); print(o["result"])'
done
