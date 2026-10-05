#!/usr/bin/env bash
# Each turn's agent seconds and cost, and the totals. Seconds from runs/<turn>.meta.txt; cost from the saved
# transcript's result line, which Claude Code reports per session, cumulatively: a resumed turn's figure includes
# the session's earlier turns. "as reported" sums those figures as the parallel rebuild did (its $39.64); "own"
# subtracts the session's previous turn, so each dollar is counted once.
# Usage: costs.sh <turn>...  (in the order they ran)
here="$(cd "$(dirname "$0")" && pwd)"; private="${SHOP_PRIVATE:-$HOME/storytree-lanes/shop-guarded-private}"
for t in "$@"; do
  s=$(sed -n 's/^exit [0-9]* seconds \([0-9]*\).*/\1/p' "$here/../runs/$t.meta.txt")
  id=$(sed -n 's/.* session \([^ ]*\).*/\1/p' "$here/../runs/$t.meta.txt")
  c=$(iconv -f UTF-16LE -t UTF-8 "$private/$t.jsonl" | tr -d '\r' | grep '"type":"result"' | tail -1 | python3 -c 'import sys,json; print(json.loads(sys.stdin.read().lstrip("﻿"))["total_cost_usd"])')
  echo "$t $s $id $c"
done | python3 -c '
import sys
last = {}; rows = []
for line in sys.stdin:
    t, s, sid, c = line.split(); s = int(s); c = float(c)
    rows.append((t, s, c, c - last.get(sid, 0.0))); last[sid] = c
print("%-16s %8s %12s %8s" % ("turn", "seconds", "as reported", "own"))
for t, s, c, own in rows: print("%-16s %8d %12.2f %8.2f" % (t, s, c, own))
print("%-16s %8d %12.2f %8.2f" % ("total", sum(r[1] for r in rows), sum(r[2] for r in rows), sum(r[3] for r in rows)))'
