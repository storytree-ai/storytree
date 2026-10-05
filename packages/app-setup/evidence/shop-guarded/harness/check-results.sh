#!/usr/bin/env bash
# The `storytree check` result of every archived CI run of the shop (ci-archive.sh's folder), one line per run:
# run id, event, branch, the run's conclusion, then what the check's two rules said. Writes checks/landings.tsv.
# Usage: check-results.sh [dir]
set -euo pipefail
dir="${1:-$HOME/storytree-lanes/shop-guarded-private/ci}"; here="$(cd "$(dirname "$0")" && pwd)"
out="$here/../checks/landings.tsv"; mkdir -p "$(dirname "$out")"
printf 'run\tevent\tbranch\tconclusion\tpackage rule\tallocation rule\n' > "$out"
while IFS=$'\t' read -r id event branch conclusion; do
  log="$dir/run-$id.log"
  pkg=$(grep -a "^storytree check" "$log" | grep -ao "The package rule: .*" | head -1 | tr -d '\r' || true)
  alloc=$(grep -a "^storytree check" "$log" | grep -ao "The allocation rule: .*" | head -1 | tr -d '\r' || true)
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$id" "$event" "$branch" "$conclusion" "${pkg:-?}" "${alloc:-?}" >> "$out"
done < <(sort -n "$dir/runs.tsv")
column -t -s $'\t' "$out"
