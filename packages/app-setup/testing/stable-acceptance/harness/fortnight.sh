#!/usr/bin/env bash
# The stable routine (ADR-1032 D6, increment_82ef0ee2a9c9), started by a weekly systemd user timer on the Mint box
# (stable-acceptance.timer) and acting every INTERVAL_DAYS (14, the owner's "every fortnight"; 7 makes it weekly).
# It takes `storytree release candidate`, runs the acceptance run (run.sh) on it, and:
#   PASS: raises one question on arc_e75e343c4afe, "Pin 0.3.N as stable?", with the evidence and the changes since
#         the last pin. The owner's yes is settled with his words, and that session runs `storytree release pin`.
#         Nothing pins by itself (ADR-0871).
#   FAIL: raises nothing to the owner. It files a friction naming a regression in that build, which the candidate
#         rule then passes over, and tries the next candidate, up to three, or records that none qualified.
#   No verdict (the judge or the harness failed, not the build), a HARNESS verdict (every failed criterion the run's
#         own), or the run's precondition failed (its user's Claude Code not signed in): files a friction about the
#         harness and stops.
# Only a judged run counts as the fortnight's: a run that could not start or be judged is tried again at the next timer
# (contract 1.17, increment_f3b08b9f235c).
# Usage: fortnight.sh [--now]   (--now skips the interval and the open-question guard checks, for a run by hand)
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(git -C "$HERE" rev-parse --show-toplevel)
ARC=arc_e75e343c4afe
# The friction a run files links the Moving stable process, where the routine is described: a friction's links name notes,
# never an arc.
NOTE=process_79d46c9c757d
INTERVAL_DAYS=${STABLE_ACCEPTANCE_INTERVAL_DAYS:-14}
HOME_DIR=$HOME/storytree-lanes/stable-acceptance
mkdir -p "$HOME_DIR"
LOG=$HOME_DIR/routine.log
log() { echo "[$(date '+%F %T')] $*" | tee -a "$LOG"; }
st() { (cd "$REPO" && pnpm -s storytree "$@"); }

if [[ ${1:-} != --now ]]; then
  last=$(cat "$HOME_DIR/last-run" 2>/dev/null || echo 0)
  if (( $(date +%s) - last < (INTERVAL_DAYS * 86400 - 6 * 3600) )); then log "not due: last run $(date -d @"$last" '+%F')"; exit 0; fi
  if st arc show "$ARC" | sed -n '/^Questions waiting on you/,/^$/p' | grep -q 'Pin 0\.3\.[0-9]* as stable?'; then
    log "a pin question is still waiting on the owner: no new run"; exit 0
  fi
fi
# A friction about the routine itself, not about a build: harness <title> <statement> <evidence file>.
harness() {
  printf '%s' "$1" > "$HOME_DIR/friction-title.txt"; printf '%s\n' "$2" > "$HOME_DIR/friction-statement.txt"
  st friction new --title "@$HOME_DIR/friction-title.txt" --description "@$HOME_DIR/friction-statement.txt" --statement "@$HOME_DIR/friction-statement.txt" \
    --evidence "@$3" --impact "No build is judged for stable until the routine runs again; the next timer tries again." --links "$NOTE" | tee -a "$LOG"
}
for attempt in 1 2 3; do
  found=$(st release candidate 2>&1); asked=$?
  # The routine's runner is its own clone (install-timer.sh), so storytree asks it to be approved as its checkout once,
  # and again whenever it is cloned anew: approve it on purpose and ask again.
  if grep -q 'is not approved as "storytree"' <<<"$found"; then
    log "approving the runner as storytree's checkout: $(st doctor --join storytree 2>&1 | head -1)"
    found=$(st release candidate 2>&1); asked=$?
  fi
  version=$(sed -n '1s/^Stable candidate: storytree \(0\.3\.[0-9]*\) .*/\1/p' <<<"$found")
  if [[ -z $version ]]; then
    log "no candidate: $(head -1 <<<"$found")"
    if (( asked != 0 )) || ! grep -q '^No build newer than' <<<"$found"; then
      printf '%s\n' "$found" > "$HOME_DIR/refusal.txt"
      harness "The stable routine could not ask for a candidate" "storytree release candidate refused on the Mint box (exit $asked), so the fortnightly stable acceptance run did not start." "$HOME_DIR/refusal.txt"
    fi
    exit 0
  fi
  pinned=$(sed -n '1s/.*(stable is \([^)]*\))\..*/\1/p' <<<"$found")
  out=$HOME_DIR/$(date -u +%Y%m%dT%H%M%SZ)-$version
  log "candidate $version (stable is $pinned): acceptance run into $out"
  start=$(date +%s)
  bash "$HERE/run.sh" "$version" "$out"; status=$?
  minutes=$(( ($(date +%s) - start + 59) / 60 ))
  cost=$(node "$HERE/cost.mjs" "$out")
  verdict=$(grep '^VERDICT:' "$out/run.log" | tail -1)
  precondition=$(grep -m1 '^PRECONDITION:' "$out/run.log" | sed 's/^PRECONDITION: *//')
  log "$version: ${verdict:-no verdict (run.sh exit $status${precondition:+: $precondition})}; $minutes minutes; $cost"
  mkdir -p "$out/library"
  # A run whose own precondition failed (its user's Claude Code not signed in) judged nothing about the build: it is
  # filed about the run, like a missing verdict, and no other build is tried, since the next would meet the same miss.
  if [[ -n $precondition ]]; then
    { echo "Evidence folder on the Mint box: $out"; echo; tail -40 "$out/run.log" 2>/dev/null; } > "$out/library/evidence.txt"
    harness "The stable acceptance run could not judge $version: $precondition" "The fortnightly acceptance run on the old laptop stopped before installing $version because its precondition failed: $precondition. The build was not judged." "$out/library/evidence.txt"
    exit 0
  fi
  # A HARNESS verdict, every failed criterion the run's own (criteria.md), judged the run, not the build: filed about the
  # harness, like no verdict, and no other build is tried (friction_58e4eda75992 was such a run filed as a regression).
  if [[ $verdict == "VERDICT: HARNESS"* ]]; then
    { echo "Evidence folder on the Mint box: $out"; echo; tail -40 "$out/verdict.txt" 2>/dev/null || tail -40 "$out/run.log"; } > "$out/library/evidence.txt"
    harness "The stable acceptance run failed on its own evidence for $version" "The fortnightly acceptance run on the old laptop could not judge $version: its judge found every failed criterion was the run's own. ${verdict#VERDICT: HARNESS: }" "$out/library/evidence.txt"
    exit 0
  fi
  # No verdict is the harness's failure, not the build's: filed as a regression it would bar this build and every later
  # one from stable (contract 4.23), so it is filed about the harness and no other build is tried.
  if [[ -z $verdict || $verdict == *"the judge gave no verdict"* ]]; then
    { echo "Evidence folder on the Mint box: $out"; echo; tail -40 "$out/run.log" 2>/dev/null; tail -20 "$out/judge.err" 2>/dev/null; } > "$out/library/evidence.txt"
    harness "The stable acceptance run gave no verdict on $version" "The fortnightly acceptance run on the old laptop ended with no verdict for $version (run.sh exit $status): the judge or the harness failed, so the build was not judged." "$out/library/evidence.txt"
    exit 0
  fi
  date +%s > "$HOME_DIR/last-run"
  if (( status == 0 )); then
    printf 'Pin %s as stable?' "$version" > "$out/library/title.txt"
    cat > "$out/library/stakes.txt" <<TXT
Which build stable users get. Yes: everyone on the stable channel (every install made with the default one-liner) takes $version at its next quiet moment, with every change merged since $pinned. No: they stay on $pinned.
TXT
    cat > "$out/library/statement.txt" <<TXT
$version passed the fortnightly acceptance run on the old laptop: a fresh Windows user installed exactly this build with the stable one-liner, the app opened, Claude Code connected, and a model-driven user built a small project through storytree with its tests passing and left feedback in the app. A separate judge passed every criterion. Pin it?
TXT
    { echo "The run's evidence (on the Mint box): $out"; echo "Its judge: $verdict"; echo "What it cost: $minutes minutes; $cost."
      echo; echo "Why $version is the candidate:"; sed -n '2,/^$/p' <<<"$found"
      echo "What changes since $pinned (the notes the pin would publish):"; sed -n '/^Pin it with:/,$p' <<<"$found" | tail -n +3; } > "$out/library/context.txt"
    cat > "$out/library/options.txt" <<TXT
a. Yes, pin it. A session settles this question with your words and runs: storytree release pin $version.
b. No, not this one. Say why: the reason is filed against $version so the routine does not offer it again, and stable stays on $pinned.
TXT
    echo "a (non-binding): the run passed every criterion; the evidence folder holds the screenshots and transcripts if you want to look first." > "$out/library/recommendation.txt"
    st question new --arc "$ARC" --title "@$out/library/title.txt" --stakes "@$out/library/stakes.txt" --statement "@$out/library/statement.txt" \
      --context "@$out/library/context.txt" --options "@$out/library/options.txt" --recommendation "@$out/library/recommendation.txt" | tee -a "$LOG"
    exit 0
  fi
  printf 'Stable acceptance run: a regression in %s' "$version" > "$out/library/title.txt"
  { echo "The fortnightly acceptance run on the old laptop failed for $version, so it cannot be pinned as stable."; echo "$verdict"; } > "$out/library/statement.txt"
  { echo "Evidence folder on the Mint box: $out"; echo; tail -40 "$out/verdict.txt" 2>/dev/null || tail -40 "$out/run.log"; } > "$out/library/evidence.txt"
  st friction new --title "@$out/library/title.txt" --description "@$out/library/statement.txt" --statement "@$out/library/statement.txt" \
    --evidence "@$out/library/evidence.txt" --impact "Stable stays on $pinned until a later build passes; fix forward and the next run takes the newer build." --links "$NOTE" \
    > "$out/library/filed.txt" 2>&1; filed=$?
  tee -a "$LOG" < "$out/library/filed.txt"
  # Unfiled, the regression would not bar this build, and the next attempt would run it again.
  if (( filed != 0 )); then log "the regression friction for $version was not filed: stopping"; exit 0; fi
done
log "three candidates failed in a row: stopping until the next run"
