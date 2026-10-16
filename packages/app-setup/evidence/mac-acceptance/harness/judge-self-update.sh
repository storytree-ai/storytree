#!/bin/bash
# Judges a self-update.sh output folder (increment_e9ed21b673a3): PASS needs Gatekeeper to accept release N as
# notarised Developer ID with the quarantine attribute set, the downloaded app to come up from that first open, then
# the one-liner's install to be running on a newer release it installed itself, with the project's story still there.
# Verdicts go to verdict.tsv.
set -u
OUT=${1:?usage: judge-self-update.sh <output folder> <0.3.n started from>}
FROM=${2:?usage: judge-self-update.sh <output folder> <0.3.n started from>}
VERDICT="$OUT/verdict.tsv"
printf 'check\tresult\n' > "$VERDICT"
failed=0

exit_of() { awk -F'\t' -v s="$1" '$1 == s { code = $2 } END { print (code == "" ? "missing" : code) }' "$OUT/steps.tsv"; }
judge() {
  local name=$1; shift
  if "$@"; then result=PASS; else result=FAIL; failed=1; fi
  printf '%s\t%s\n' "$name" "$result" >> "$VERDICT"
}
INSTALLED="$HOME/Applications/storytree-0.3.app"
newer() { local v; v=$(tr -d '[:space:]' < "$OUT/version-after.txt" 2>/dev/null); [ -n "$v" ] && [ "${v#0.3.}" -gt "${FROM#0.3.}" ] 2>/dev/null; }

judge installed-n [ "$(tr -d '[:space:]' < "$OUT/version-before.txt" 2>/dev/null)" = "$FROM" ]
judge quarantined [ "$(exit_of quarantine)" = 0 ]
judge spctl-notarised grep -q 'source=Notarized Developer ID' "$OUT/spctl.txt"
judge first-open-running grep -q 'storytree-0.3.app/Contents/MacOS/storytree-0.3$' "$OUT/processes-open.txt"
judge updated-itself [ "$(exit_of update-wait)" = 0 ]
judge newer-version newer
judge installed-running grep -q " $INSTALLED/Contents/MacOS/storytree-0.3\$" "$OUT/processes-installed.txt"
judge running-after grep -q " $INSTALLED/Contents/MacOS/storytree-0.3\$" "$OUT/processes-after.txt"
judge postgres-after grep -q " $INSTALLED/Contents/Resources/postgres/bin/postgres " "$OUT/processes-after.txt"
judge project-kept grep -q 'Keep a to-do list' "$OUT/tree-after.txt"
judge spctl-after grep -q 'source=Notarized Developer ID' "$OUT/spctl-after.txt"

cat "$VERDICT"
exit "$failed"
