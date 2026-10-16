#!/bin/bash
# Judges a self-update.sh output folder (increment_9184e6e6e3fe): PASS needs the stable (or named build's) one-liner's install, with
# the setup check passing on it, to be running afterwards on a newer release with its arc still there and the setup
# check passing again. proved-by.txt says whether the app updated itself or the newest one-liner was run over it.
# Given self-update, self-updated fails on the second, so a run that fell back is never read as the self-update
# proved; given either (stable's leg, while stable predates the AppImage self-update), it records which.
# Verdicts go to verdict.tsv.
set -u
OUT=${1:?usage: judge-self-update.sh <output folder> [self-update|either]}
REQUIRE=${2:-self-update}
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
judge first-installed [ "$(exit_of version-before)" = 0 ]
judge doctor-before [ "$(exit_of doctor-before)" = 0 ]
judge arc-made grep -q 'A to-do page' "$OUT/arcs-before.txt"
PROVED=$(tr -d '[:space:]' < "$OUT/proved-by.txt" 2>/dev/null)
if [ "$REQUIRE" = either ]; then
  judge "updated-by-${PROVED:-nothing}" grep -qx -e self-update -e one-liner "$OUT/proved-by.txt"
else
  judge self-updated [ "$PROVED" = self-update ]
fi
judge newer-version newer
judge running-after grep -q '\.local/share/storytree-0\.3/storytree-0\.3' "$OUT/processes-after.txt"
judge postgres-after grep -q 'resources/postgres/bin/postgres ' "$OUT/processes-after.txt"
judge arc-kept grep -q 'A to-do page' "$OUT/arcs-after.txt"
judge doctor-after [ "$(exit_of doctor-after)" = 0 ]

cat "$VERDICT"
exit "$failed"
