#!/usr/bin/env bash
# Archives every finished CI run of the shop's repository, as the website export's --ci folder reads it:
# runs.tsv (id, event, branch, conclusion) and run-<id>.log per run. Runs already saved are kept, not fetched again.
# Usage: ci-archive.sh [dir]  (default ~/storytree-lanes/shop-parallel-private/ci)
set -euo pipefail
dir="${1:-$HOME/storytree-lanes/shop-parallel-private/ci}"; repo="${SHOP_REPO:-HuaMick/shop2}"
mkdir -p "$dir"
gh run list -R "$repo" --limit 200 --status completed --json databaseId,event,headBranch,conclusion \
  -q '.[] | [.databaseId, .event, .headBranch, .conclusion] | @tsv' > "$dir/runs.tsv"
while IFS=$'\t' read -r id _ _ _; do
  [ -s "$dir/run-$id.log" ] || gh run view -R "$repo" "$id" --log > "$dir/run-$id.log" 2>/dev/null || true
done < "$dir/runs.tsv"
echo "$(wc -l < "$dir/runs.tsv") runs in $dir"
