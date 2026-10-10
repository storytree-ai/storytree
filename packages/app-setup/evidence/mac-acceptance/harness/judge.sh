#!/bin/bash
# Judges a run.sh output folder for check (a) of decision_b0a98e971a05 D4 (increment_4bc9955ff232): the release
# workflow's Mac acceptance job fails on what a first user cannot get past. run.sh records and carries on; this
# exits 1 when any judged check fails, and writes the verdicts to verdict.tsv beside the evidence.
# Recorded, not judged: hooks, until increment_9e50c19dfefe makes a never-run Claude Code get them, and
# spctl --assess, which says "rejected" for an ad-hoc signature until the Developer ID lands (increment_9d05fb8a164b).
set -u
OUT=${1:?usage: judge.sh <output folder> [expected version]}
EXPECTED=${2:-}
VERDICT="$OUT/verdict.tsv"
printf 'check\tresult\n' > "$VERDICT"
failed=0

exit_of() { awk -F'\t' -v s="$1" '$1 == s { code = $2 } END { print (code == "" ? "missing" : code) }' "$OUT/steps.tsv"; }

# judge NAME CONDITION…: records PASS or FAIL for NAME by whether the condition command succeeds.
judge() {
  local name=$1; shift
  if "$@"; then result=PASS; else result=FAIL; failed=1; fi
  printf '%s\t%s\n' "$name" "$result" >> "$VERDICT"
}

# The pipe hides a failed download: curl fails, sh reads nothing and exits 0. So the install also needs the app
# it should have put in ~/Applications, at the version this release published.
judge install-exit [ "$(exit_of install)" = 0 ]
judge app-present [ "$(exit_of version)" = 0 ]
if [ -n "$EXPECTED" ]; then
  judge app-version [ "$(tr -d '[:space:]' 2>/dev/null < "$OUT/version.txt")" = "$EXPECTED" ]
fi
judge app-running grep -q 'storytree-0.3.app/Contents/MacOS/storytree-0.3$' "$OUT/processes.txt"
judge postgres-running grep -q 'storytree-0.3.app/Contents/Resources/postgres/bin/postgres ' "$OUT/processes.txt"
judge doctor-exit [ "$(exit_of doctor)" = 0 ]

cat "$VERDICT"
exit "$failed"
