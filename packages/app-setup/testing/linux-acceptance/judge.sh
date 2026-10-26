#!/bin/bash
# Judges a run.sh output folder (increment_46e44175295b), the twin of mac-acceptance/judge.sh: the release
# workflow's Linux acceptance job fails on what a first user cannot get past. run.sh records and carries on; this
# exits 1 when any judged check fails, and writes the verdicts to verdict.tsv beside the evidence.
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

# The pipe hides a failed download: curl fails, sh reads nothing and exits 0. So the install also needs the AppImage
# it should have put in ~/.local/share, at the version this release published.
judge install-exit [ "$(exit_of install)" = 0 ]
judge app-present [ "$(exit_of version)" = 0 ]
if [ -n "$EXPECTED" ]; then
  judge app-version [ "$(tr -d '[:space:]' 2>/dev/null < "$OUT/version.txt")" = "$EXPECTED" ]
fi
# The running AppImage is the installed file; its database runs from the AppImage's mount.
judge app-running grep -q '\.local/share/storytree-0\.3/storytree-0\.3' "$OUT/processes.txt"
judge postgres-running grep -q 'resources/postgres/bin/postgres ' "$OUT/processes.txt"
judge doctor-exit [ "$(exit_of doctor)" = 0 ]
judge hooks-written grep -q 'storytree' "$OUT/hooks.txt"

cat "$VERDICT"
exit "$failed"
