#!/usr/bin/env bash
# The stable routine (ADR-1032 D6, increment_82ef0ee2a9c9), started by a weekly systemd user timer on the Mint box
# (stable-acceptance.timer) and acting every INTERVAL_DAYS (14, the owner's "every fortnight"; 7 makes it weekly).
# It takes `storytree release candidate`, runs the acceptance run (run.sh) on it, and:
#   PASS: raises one question on arc_312aa103bfca, "Pin 0.3.N as stable?", with the evidence and the changes since
#         the last pin. The owner's yes is settled with his words, and that session runs `storytree release pin`.
#         Nothing pins by itself (ADR-0871).
#   FAIL: raises nothing to the owner. It files a friction naming a regression in that build, which the candidate
#         rule then passes over, and tries the next candidate, up to three, or records that none qualified.
# Usage: fortnight.sh [--now]   (--now skips the interval and the open-question guard checks, for a run by hand)
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(git -C "$HERE" rev-parse --show-toplevel)
ARC=arc_312aa103bfca
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
date +%s > "$HOME_DIR/last-run"
for attempt in 1 2 3; do
  found=$(st release candidate 2>&1)
  version=$(sed -n '1s/^Stable candidate: storytree \(0\.3\.[0-9]*\) .*/\1/p' <<<"$found")
  if [[ -z $version ]]; then log "no candidate: $(head -1 <<<"$found")"; exit 0; fi
  pinned=$(sed -n '1s/.*(stable is \([^)]*\))\..*/\1/p' <<<"$found")
  out=$HOME_DIR/$(date -u +%Y%m%dT%H%M%SZ)-$version
  log "candidate $version (stable is $pinned): acceptance run into $out"
  start=$(date +%s)
  bash "$HERE/run.sh" "$version" "$out"; status=$?
  minutes=$(( ($(date +%s) - start + 59) / 60 ))
  cost=$(node "$HERE/cost.mjs" "$out")
  verdict=$(grep '^VERDICT:' "$out/run.log" | tail -1)
  log "$version: ${verdict:-no verdict (run.sh exit $status)}; $minutes minutes; $cost"
  mkdir -p "$out/library"
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
    --evidence "@$out/library/evidence.txt" --impact "Stable stays on $pinned until a later build passes; fix forward and the next run takes the newer build." --links "$ARC" | tee -a "$LOG"
done
log "three candidates failed in a row: stopping until the next run"
