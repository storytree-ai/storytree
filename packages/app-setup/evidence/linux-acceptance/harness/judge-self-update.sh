#!/bin/bash
# Judges a self-update.sh output folder (increment_9184e6e6e3fe): PASS needs the stable one-liner's install, with
# the setup check passing on it, to be running afterwards on a newer release with its arc still there and the setup
# check passing again. proved-by.txt says whether the app updated itself or the newest one-liner was run over it;
# self-updated fails on the second, so a run that fell back is never read as the self-update proved.
# Verdicts go to verdict.tsv.
set -u
OUT=${1:?usage: judge-self-update.sh <output folder>}
VERDICT="$OUT/verdict.tsv"
printf 'check\tresult\n' > "$VERDICT"
failed=0

exit_of() { awk -F'\t' -v s="$1" '$1 == s { code = $2 } END { print (code == "" ? "missing" : code) }' "$OUT/steps.tsv"; }
judge() {
  local name=$1; shift
  if "$@"; then result=PASS; else result=FAIL; failed=1; fi
  printf '%s\t%s\n' "$name" "$result" >> "$VERDICT"
}
FROM=$(tr -d '[:space:]' < "$OUT/version-before.txt" 2>/dev/null)
newer() { local v; v=$(tr -d '[:space:]' < "$OUT/version-after.txt" 2>/dev/null); [ -n "$v" ] && [ -n "$FROM" ] && [ "${v#0.3.}" -gt "${FROM#0.3.}" ] 2>/dev/null; }

judge install-exit [ "$(exit_of install)" = 0 ]
judge stable-installed [ "$(exit_of version-before)" = 0 ]
judge doctor-before [ "$(exit_of doctor-before)" = 0 ]
judge arc-made grep -q 'A to-do page' "$OUT/arcs-before.txt"
judge self-updated [ "$(tr -d '[:space:]' < "$OUT/proved-by.txt" 2>/dev/null)" = self-update ]
judge newer-version newer
judge running-after grep -q '\.local/share/storytree-0\.3/storytree-0\.3' "$OUT/processes-after.txt"
judge postgres-after grep -q 'resources/postgres/bin/postgres ' "$OUT/processes-after.txt"
judge arc-kept grep -q 'A to-do page' "$OUT/arcs-after.txt"
judge doctor-after [ "$(exit_of doctor-after)" = 0 ]

cat "$VERDICT"
exit "$failed"
